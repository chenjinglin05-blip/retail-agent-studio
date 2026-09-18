import { analyze, dataset } from '@/lib/engine';
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 4096)
      return Response.json({ error: '请求过长' }, { status: 413 });
    const body = JSON.parse(text);
    if (
      typeof body.query !== 'string' ||
      body.query.trim().length < 2 ||
      body.query.length > 500 ||
      !dataset.stores.some((s) => s.id === body.storeId)
    )
      return Response.json(
        { error: '请提供有效门店和 2–500 字问题' },
        { status: 400 },
      );
    const backend = process.env.AGENT_BACKEND_URL;
    if (backend) {
      try {
        const result = await fetch(backend.replace(/\/$/, '') + '/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: body.query, storeId: body.storeId }),
          signal: AbortSignal.timeout(45000),
        });
        if (!result.ok) throw new Error('backend error');
        return Response.json(await result.json());
      } catch {
        return Response.json(
          {
            error:
              'Python 服务暂时不可用，请检查服务或移除 AGENT_BACKEND_URL 后使用演示引擎。',
          },
          { status: 503 },
        );
      }
    }
    return Response.json(analyze(body.query, body.storeId));
  } catch {
    return Response.json(
      { error: '请求格式有误，请输入有效问题。' },
      { status: 400 },
    );
  }
}
