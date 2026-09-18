import { backendRequest } from '@/lib/backend-proxy';

export async function GET() {
  if (!process.env.AGENT_BACKEND_URL) {
    return Response.json({ backend: 'demo', ollama: 'unknown', model: '' });
  }
  return backendRequest('/api/services');
}
