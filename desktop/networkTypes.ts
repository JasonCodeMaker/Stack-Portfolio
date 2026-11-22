export interface NetworkRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export interface NetworkResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface NetworkClient {
  request(request: NetworkRequest): Promise<NetworkResponse>;
}
