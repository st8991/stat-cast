"""Generate the synthetic Statcast sample in data/sample/.

The pipeline normally pulls from Baseball Savant. This file lets everything
(tests, CI, the docker demo) run offline. It is SYNTHETIC: fictional teams,
pitchers and batters with Statcast-shaped columns and plausible distributions.
Its numbers describe no real player.

    python scripts/make_sample.py
"""

from __future__ import annotations

import gzip
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20250602
OUT = Path(__file__).resolve().parents[1] / "data" / "sample" / "statcast_sample.csv.gz"
FIRST_DAY = date(2025, 6, 2)
DAYS = 8
OFF_DAYS = {date(2025, 6, 5)}  # exercises the "no games" path

# pitch_type, pitch_name, velo, spin, pfx_x (ft, RHP catcher view), pfx_z (ft), spin_axis, whiff_rate
PITCHES = {
    "FF": ("4-Seam Fastball", 95.0, 2350, -0.65, 1.35, 210, 0.20),
    "SI": ("Sinker", 94.0, 2200, -1.25, 0.70, 230, 0.12),
    "FC": ("Cutter", 89.0, 2450, 0.20, 0.75, 190, 0.22),
    "SL": ("Slider", 85.5, 2500, 0.45, 0.15, 90, 0.34),
    "ST": ("Sweeper", 82.5, 2650, 1.20, 0.05, 70, 0.33),
    "CU": ("Curveball", 79.5, 2650, 0.60, -0.90, 40, 0.30),
    "CH": ("Changeup", 86.0, 1750, -1.15, 0.45, 240, 0.31),
    "FS": ("Split-Finger", 86.5, 1300, -0.80, 0.25, 235, 0.35),
}

FIRST = ["Dorian", "Wes", "Mateo", "Calvin", "Rory", "Eli", "Hank", "Jonah", "Felix", "Toby",
         "Cyrus", "Nico", "Bram", "Otis", "Reid", "Silas"]
LAST = ["Hale", "Okafor", "Varga", "Lindqvist", "Paz", "Thorne", "Abernathy", "Kurosawa", "Delgado",
        "Brandt", "Mercer", "Sato", "Whitlock", "Ibarra", "Quill", "Rasmussen"]


@dataclass
class Pitcher:
    pid: int
    name: str
    throws: str
    role: str
    arsenal: dict[str, float]  # pitch_type -> usage
    velo_offset: float
    ivb_offset: float
    release_x: float
    release_z: float
    extension: float
    release_sd: float
    arm_angle: float
    type_offsets: dict[str, tuple[float, float]] = field(default_factory=dict)


def make_pitchers(rng: np.random.Generator) -> dict[str, list[Pitcher]]:
    archetypes = [
        {"FF": 0.45, "SL": 0.30, "CH": 0.15, "CU": 0.10},
        {"SI": 0.40, "FF": 0.15, "ST": 0.30, "CH": 0.15},
        {"FF": 0.50, "CU": 0.25, "FS": 0.25},
        {"FF": 0.35, "FC": 0.30, "SL": 0.20, "CH": 0.15},
        {"FF": 0.60, "SL": 0.40},
        {"SI": 0.55, "ST": 0.45},
        {"FF": 0.55, "FS": 0.45},
        {"FC": 0.45, "FF": 0.30, "CU": 0.25},
    ]
    teams: dict[str, list[Pitcher]] = {"RVR": [], "LKS": []}
    pid, k = 990001, 0
    for team in teams:
        for i in range(8):
            throws = "L" if rng.random() < 0.3 else "R"
            arm = float(rng.normal(45, 9))
            sign = 1 if throws == "R" else -1
            arsenal = archetypes[(i + (3 if team == "LKS" else 0)) % len(archetypes)]
            teams[team].append(
                Pitcher(
                    pid=pid,
                    name=f"{LAST[k]}, {FIRST[k]}",
                    throws=throws,
                    role="SP" if i < 4 else "RP",
                    arsenal=arsenal,
                    velo_offset=float(rng.normal(0 if i < 4 else 1.2, 1.2)),
                    ivb_offset=float(rng.normal(0, 0.15)),
                    release_x=float(-sign * rng.uniform(1.4, 2.6)),
                    release_z=float(rng.uniform(5.4, 6.4)),
                    extension=float(rng.uniform(5.9, 7.2)),
                    release_sd=float(rng.uniform(0.06, 0.22)),
                    arm_angle=arm,
                    type_offsets={pt: (float(rng.normal(0, 0.12)), float(rng.normal(0, 0.10))) for pt in arsenal},
                )
            )
            pid += 1
            k += 1
    return teams


def zone_of(x: float, z: float) -> int:
    if abs(x) <= 0.83 and 1.5 <= z <= 3.5:
        col = 0 if x < -0.277 else (1 if x <= 0.277 else 2)
        row = 0 if z > 2.833 else (1 if z >= 2.167 else 2)
        return 1 + row * 3 + col
    if z > 2.5:
        return 11 if x < 0 else 12
    return 13 if x < 0 else 14


def simulate_pitch(rng, p: Pitcher, pitch_count: int):
    types = list(p.arsenal)
    pt = rng.choice(types, p=np.array([p.arsenal[t] for t in types]))
    name, velo, spin, pfx_x, pfx_z, axis, whiff = PITCHES[pt]
    fatigue = max(0, pitch_count - 60) * 0.012
    sign = 1 if p.throws == "R" else -1
    ox, oz = p.type_offsets[pt]
    rel_x = p.release_x + ox + rng.normal(0, p.release_sd)
    rel_z = p.release_z + oz + rng.normal(0, p.release_sd) - fatigue * 0.02
    plate_x = float(rng.normal(0.1 * sign, 0.75))
    plate_z = float(rng.normal(2.45, 0.75))
    speed = float(rng.normal(velo + p.velo_offset - fatigue, 0.8))
    return {
        "pitch_type": pt,
        "pitch_name": name,
        "release_speed": round(speed, 1),
        "effective_speed": round(speed + rng.normal(0.3, 0.5), 1),
        "release_spin_rate": round(float(rng.normal(spin, 70))),
        "spin_axis": round(float((axis if sign == 1 else 360 - axis) + rng.normal(0, 8)) % 360),
        "release_extension": round(float(rng.normal(p.extension, 0.12)), 1),
        "release_pos_x": round(float(rel_x), 2),
        "release_pos_y": round(float(60.5 - p.extension + rng.normal(0, 0.1)), 2),
        "release_pos_z": round(float(rel_z), 2),
        "arm_angle": round(float(rng.normal(p.arm_angle, 1.5)), 1),
        "pfx_x": round(float(sign * pfx_x + rng.normal(0, 0.12)), 2),
        "pfx_z": round(float(pfx_z + p.ivb_offset + rng.normal(0, 0.10)), 2),
        "plate_x": round(plate_x, 2),
        "plate_z": round(plate_z, 2),
        "sz_top": 3.4,
        "sz_bot": 1.6,
        "zone": zone_of(plate_x, plate_z),
    }, whiff


def simulate_game(rng, game_pk: int, game_date: date, home: str, away: str, staff, rotation_slot: int):
    rows: list[dict] = []
    batters = {t: [(800000 + 100 * j + i, "L" if i % 3 == 0 else "R") for i in range(9)] for j, t in enumerate(staff)}
    ab_number = 0
    for inning in range(1, 10):
        for half, fielding, batting in (("Top", home, away), ("Bot", away, home)):
            pitchers = staff[fielding]
            starter = pitchers[rotation_slot % 4]
            relievers = pitchers[4:]
            outs = 0
            while outs < 3:
                ab_number += 1
                spent = sum(1 for r in rows if r["pitcher"] == starter.pid)
                if spent < 92 and inning <= 6:
                    p = starter
                else:
                    p = relievers[(inning + rotation_slot) % len(relievers)]
                batter, stand = batters[batting][ab_number % 9]
                balls = strikes = 0
                pitch_number = 0
                while True:
                    pitch_number += 1
                    pc = sum(1 for r in rows if r["pitcher"] == p.pid)
                    pitch, whiff_rate = simulate_pitch(rng, p, pc)
                    in_zone = pitch["zone"] <= 9
                    swing = rng.random() < (0.66 if in_zone else 0.29)
                    row = {
                        "game_pk": game_pk, "game_date": game_date.isoformat(), "game_year": game_date.year,
                        "game_type": "R", "at_bat_number": ab_number, "pitch_number": pitch_number,
                        "inning": inning, "inning_topbot": half, "outs_when_up": outs,
                        "balls": balls, "strikes": strikes, "home_team": home, "away_team": away,
                        "pitcher": p.pid, "player_name": p.name, "batter": batter,
                        "p_throws": p.throws, "stand": stand, **pitch,
                        "events": None, "bb_type": None, "launch_speed": None, "launch_angle": None,
                        "estimated_woba_using_speedangle": None, "woba_value": None,
                    }
                    end = None
                    if not swing:
                        if in_zone:
                            row.update(type="S", description="called_strike", delta_run_exp=-0.05)
                            strikes += 1
                        else:
                            row.update(type="B", description="ball", delta_run_exp=0.04)
                            balls += 1
                    elif rng.random() < whiff_rate:
                        row.update(type="S", description="swinging_strike", delta_run_exp=-0.06)
                        strikes += 1
                    elif rng.random() < 0.5:
                        row.update(type="S", description="foul", delta_run_exp=-0.03 if strikes < 2 else 0.0)
                        strikes = min(strikes + 1, 2) if strikes < 2 else strikes
                    else:
                        ev = float(rng.normal(89, 12))
                        la = float(rng.normal(12, 25))
                        xwoba = max(0.0, min(2.0, (ev - 70) / 40 * (1 - abs(la - 18) / 60)))
                        r = rng.random()
                        event, woba, dre = (
                            ("home_run", 2.0, 1.4) if ev > 100 and 20 < la < 35 and r < 0.6
                            else ("double", 1.25, 0.75) if r < 0.07
                            else ("single", 0.9, 0.45) if r < 0.30
                            else ("field_out", 0.0, -0.27)
                        )
                        row.update(
                            type="X", description="hit_into_play", events=event, delta_run_exp=dre,
                            bb_type="fly_ball" if la > 25 else "line_drive" if la > 10 else "ground_ball",
                            launch_speed=round(ev, 1), launch_angle=round(la),
                            estimated_woba_using_speedangle=round(xwoba, 3),
                            woba_value=woba,
                        )
                        end = event
                    if strikes == 3:
                        end = "strikeout"
                        row["events"] = end
                        row["woba_value"] = 0.0
                    elif balls == 4:
                        end = "walk"
                        row["events"] = end
                        row["woba_value"] = 0.69
                    rows.append(row)
                    if end:
                        if end in ("strikeout", "field_out"):
                            outs += 1
                        break
    return rows


def main() -> None:
    rng = np.random.default_rng(SEED)
    staff = make_pitchers(rng)
    rows: list[dict] = []
    game_pk = 900001
    slot = 0
    for i in range(DAYS):
        d = FIRST_DAY + timedelta(days=i)
        if d in OFF_DAYS:
            continue
        home, away = ("RVR", "LKS") if i % 2 == 0 else ("LKS", "RVR")
        rows += simulate_game(rng, game_pk, d, home, away, staff, slot)
        game_pk += 1
        slot += 1

    df = pd.DataFrame(rows)
    # Real Savant quirks the loader has to cope with:
    df["pitcher.1"] = df["pitcher"]          # Savant repeats some id columns with a ".1" suffix
    df["sv_id"] = None                       # deprecated column nobody uses
    df = pd.concat([df, df.iloc[[10]]], ignore_index=True)  # one repeated pitch
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.GzipFile(OUT, "wb", mtime=0) as fh:  # mtime=0 keeps the file byte-identical across runs
        fh.write(df.to_csv(index=False).encode())
    print(f"wrote {len(df)} rows, {df['game_date'].nunique()} game dates, {df['pitcher'].nunique()} pitchers -> {OUT}")


if __name__ == "__main__":
    main()
