export async function GET() {
  return Response.json({
    status: 'ok',
    mode: process.env.AGENT_BACKEND_URL ? 'python-proxy' : 'rules',
    dataset: 'synthetic',
  });
}
