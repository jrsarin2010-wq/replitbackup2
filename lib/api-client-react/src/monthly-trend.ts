import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult, QueryKey } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";

export interface MonthlyTrendItem {
  month: string;
  appointments: number;
  revenue: number;
  recoveredPatients: number;
  leadsConverted: number;
}

export interface MonthlyTrendResponse {
  months: number;
  data: MonthlyTrendItem[];
  error?: string;
}

export interface GetMonthlyTrendParams {
  months?: number;
}

export const getMonthlyTrendUrl = (params?: GetMonthlyTrendParams) => {
  const qs = params?.months ? `?months=${params.months}` : "";
  return `/api/dental/reports/monthly-trend${qs}`;
};

export const getMonthlyTrend = async (
  params?: GetMonthlyTrendParams,
  options?: RequestInit,
): Promise<MonthlyTrendResponse> => {
  return customFetch<MonthlyTrendResponse>(getMonthlyTrendUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getGetMonthlyTrendQueryKey = (params?: GetMonthlyTrendParams) => {
  return [`/api/dental/reports/monthly-trend`, params] as const;
};

export const getGetMonthlyTrendQueryOptions = <
  TData = Awaited<ReturnType<typeof getMonthlyTrend>>,
  TError = ErrorType<unknown>,
>(
  params?: GetMonthlyTrendParams,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMonthlyTrend>>, TError, TData>;
    request?: RequestInit;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetMonthlyTrendQueryKey(params);
  const queryFn = ({ signal }: { signal?: AbortSignal }) =>
    getMonthlyTrend(params, { signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getMonthlyTrend>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export function useGetMonthlyTrend<
  TData = Awaited<ReturnType<typeof getMonthlyTrend>>,
  TError = ErrorType<unknown>,
>(
  params?: GetMonthlyTrendParams,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMonthlyTrend>>, TError, TData>;
    request?: RequestInit;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetMonthlyTrendQueryOptions(params, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  return { ...query, queryKey: queryOptions.queryKey };
}
