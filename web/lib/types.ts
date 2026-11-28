// Response shapes of the dashboard API, shared by the route handlers and the UI.
// Column names match the dbt marts one to one.

export type Num = number | null;

export interface Totals {
  pitches: number;
  pitchers: number;
  games: number;
  first_game_date: string | null;
  last_game_date: string | null;
}

export interface RosterPitcher {
  pitcher_id: number;
  pitcher_name: string;
  pitcher_hand: "R" | "L" | string;
  latest_team: string;
  pitches: number;
  games: number;
  last_game_date: string;
  primary_pitch_type: string | null;
  last_fb_velo_mph: Num;
  last_velo_vs_baseline_mph: Num;
  last_game_velo_drop: boolean;
  any_velo_drop: boolean;
  fb_velo_by_game: number[];
}

export interface LeaderRow {
  pitcher_id: number;
  pitcher_name: string;
  pitch_type: string;
  value: number;
}

export type Board = "velo" | "ride" | "whiff" | "consistency";

export interface LeagueShape {
  pitch_type: string;
  pitch_name: string;
  pitches: number;
  velo_mph: Num;
  ivb_in: Num;
  arm_side_break_in: Num;
}

export interface VeloAlert {
  pitcher_id: number;
  pitcher_name: string;
  game_date: string;
  fb_velo_mph: Num;
  velo_vs_baseline_mph: Num;
}

export interface Overview {
  season: number | null;
  seasons: number[];
  totals: Totals;
  pitchers: RosterPitcher[];
  leaders: Record<Board, LeaderRow[]>;
  league_shape: LeagueShape[];
  alerts: VeloAlert[];
}

export interface Profile {
  pitcher_id: number;
  pitcher_name: string;
  pitcher_hand: string;
  latest_team: string;
  first_game_date: string;
  last_game_date: string;
  games: number;
  pitches: number;
}

export interface ArsenalRow {
  season: number;
  pitcher_id: number;
  pitcher_name: string;
  pitch_type: string;
  pitch_name: string;
  pitches: number;
  usage_pct: number;
  avg_velo_mph: Num;
  avg_spin_rpm: Num;
  avg_ivb_in: number;
  avg_arm_side_break_in: number;
  avg_extension_ft: Num;
  whiff_pct: Num;
  csw_pct: Num;
  zone_pct: Num;
  chase_pct: Num;
  xwoba_on_contact: Num;
  run_value_per_100: Num;
  velo_vs_league_mph: Num;
  ivb_vs_league_in: Num;
  arm_side_vs_league_in: Num;
  ivb_z: Num;
  arm_side_z: Num;
}

export interface Release {
  primary_pitch_type: string;
  release_x_ft: number;
  release_z_ft: number;
  release_x_sd_in: number;
  release_z_sd_in: number;
  release_spread_in: Num;
  extension_sd_in: Num;
  arm_angle_sd_deg: Num;
  max_tunnel_gap_in: Num;
  avg_tunnel_gap_in: Num;
  consistency_pctile: Num;
}

export interface GameTrend {
  game_pk: number;
  game_date: string;
  fastballs: number;
  fb_velo_mph: number;
  fb_max_velo_mph: number;
  release_z_ft: Num;
  extension_ft: Num;
  prior_games: number;
  velo_vs_baseline_mph: Num;
  release_z_vs_baseline_in: Num;
  velo_drop_flag: boolean;
}

export interface PitchPoint {
  pitch_type: string;
  velo_mph: Num;
  ivb_in: number;
  arm_side_break_in: number;
  release_x_ft: Num;
  release_z_ft: Num;
  plate_x_ft: Num;
  plate_z_ft: Num;
  is_whiff: boolean | null;
  is_csw: boolean | null;
}

export interface PitcherDetail {
  season: number;
  profile: Profile;
  arsenal: ArsenalRow[];
  release: Release | null;
  league_release: { avg_release_spread_in: Num; avg_max_tunnel_gap_in: Num } | null;
  trends: GameTrend[];
  pitches: PitchPoint[];
}

export interface TaskInstance {
  task_id: string;
  state: string | null;
  try_number: number | null;
  start_date: string | null;
  end_date: string | null;
}

export interface DagRun {
  run_id: string;
  run_type: string;
  state: string | null;
  logical_date: string | null;
  run_after: string | null;
  start_date: string | null;
  end_date: string | null;
  game_date: string | null;
  duration_s?: number;
  tasks: TaskInstance[];
}

export type AirflowRuns =
  | { available: false; reason: string }
  | { available: true; dag_id: string; runs: DagRun[] };

export interface Health {
  table_counts: { table: string; rows: number | null }[];
  freshness: {
    last_loaded_at: string | null;
    last_game_date: string | null;
    hours_since_load: Num;
    warn_after_hours: number;
  };
  recent_loads: { game_date: string; row_count: number; source: string; loaded_at: string }[];
  rows_by_date: { game_date: string; pitches: number; games: number }[];
  airflow: AirflowRuns;
  mode: "live" | "snapshot";
  exported_at?: string;
}
