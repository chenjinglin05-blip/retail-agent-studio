export async function backendRequest(path: string, init: RequestInit = {}) {
  const backend = process.env.AGENT_BACKEND_URL;
  if (!backend) {
    return Response.json(
      {
        error: '此功能需要本地 Python 服务。请使用项目中的“启动完整项目.cmd”。',
      },
      { status: 503 },
    );
  }
  try {
    const response = await fetch(backend.replace(/\/$/, '') + path, {
      ...init,
      signal: AbortSignal.timeout(init.method === 'POST' ? 190_000 : 5_000),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const detail =
        typeof data === 'object' && data !== null && 'detail' in data
          ? data.detail
          : null;
      return Response.json(
        {
          error:
            typeof detail === 'string'
              ? detail
              : '参数不完整或格式不正确，请核对后重试。',
        },
        { status: response.status },
      );
    }
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    return Response.json(
      {
        error: timeout
          ? '等待服务响应超时。可以重试，或切换到手动填写参数。'
          : '无法连接 Python 服务，请双击“启动完整项目.cmd”后重试。',
      },
      { status: timeout ? 504 : 503 },
    );
  }
}

export async function readObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 4096) throw new Error('请求过长');
  const body: unknown = JSON.parse(text);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('请求必须是 JSON 对象');
  return body as Record<string, unknown>;
}
