/**
 * Shared API types mirroring shared/types contracts.
 */
export type { Role } from "./roles";

export interface ApiListResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
