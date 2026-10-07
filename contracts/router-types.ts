/**
 * Type-only inference helpers for tRPC router outputs.
 * These are erased at compile time — no server code reaches the browser bundle.
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../api/router";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type PickListRow = RouterOutputs["picks"]["list"][number];
export type PickDetail = RouterOutputs["picks"]["detail"];
export type BestNow = RouterOutputs["picks"]["bestNow"];
export type EventRow = RouterOutputs["odds"]["events"][number];
export type LineHistoryPoint = RouterOutputs["odds"]["lineHistory"][number];
export type PropRow = RouterOutputs["props"]["list"][number];
export type PerfSummary = RouterOutputs["performance"]["summary"];
export type UserBet = RouterOutputs["tracker"]["list"][number];
export type ParlayResult = RouterOutputs["parlays"]["suggest"];
export type AdminStats = RouterOutputs["admin"]["stats"];
