import { httpClient } from '@/http/client';

// SWR Fetcher 函数
export const fetcher = async (url: string) => {
  const response = await httpClient.get(url);
  return response.data;
};

// 带参数的 fetcher
export const fetcherWithParams = async (url: string, params: Record<string, any>) => {
  const response = await httpClient.get(url, { params });
  return response.data;
};

// POST 请求 fetcher
export const poster = async (url: string, data: any) => {
  const response = await httpClient.post(url, data);
  return response.data;
};

// PUT 请求 fetcher
export const putter = async (url: string, data: any) => {
  const response = await httpClient.put(url, data);
  return response.data;
};

// DELETE 请求 fetcher
export const deleter = async (url: string) => {
  const response = await httpClient.delete(url);
  return response.data;
};

// PATCH 请求 fetcher
export const patcher = async (url: string, data: any) => {
  const response = await httpClient.patch(url, data);
  return response.data;
};

// 导出所有 fetcher 函数
export const swrFetcher = {
  get: fetcher,
  getWithParams: fetcherWithParams,
  post: poster,
  put: putter,
  delete: deleter,
  patch: patcher,
};