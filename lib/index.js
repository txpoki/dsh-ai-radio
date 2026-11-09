import { homedir } from 'node:os';
import { join } from 'node:path';
import { RadioService } from './service.js';

export const name = 'dsh-ai-radio';
export const inject = ['webServer', 'llm', 'tools', 'systemPrompt'];
export function apply(ctx, config = {}) {
  const get = key => { try { return ctx[key] || ctx.get?.(key); } catch { return undefined; } };
  const directory = config.dataDir || process.env.AI_RADIO_DATA_DIR || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'ai-radio');
  const service = new RadioService({ directory, llm: get('llm') });
  ctx.effect(() => get('webServer').register({ kind: 'prefix', path: '/dsh-ai-radio', handler: service.handler }), 'ai-radio: HTTP routes');
  ctx.effect(() => () => service.dispose(), 'ai-radio: dispose');
  const tools = get('tools');
  if (tools?.register) ctx.effect(() => tools.register({
    name: 'ai_radio', description: '控制私人 AI 电台。支持开始、暂停、继续、下一首、停止和按歌名或歌手点歌。首次使用先在电台面板登录网易云、选择歌单并点击播放解锁浏览器音频。',
    parameters: { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['play', 'pause', 'resume', 'next', 'stop', 'request'] }, query: { type: 'string', description: '点歌时的歌名、歌手或风格要求，音乐从已选歌单中挑选' } }, required: ['action'] },
    output: { schema: { type: 'object', properties: { notice: { type: 'string' } } }, render: (_args, result) => [{ type: 'text', text: result.notice }] },
    async execute(args) { service.command(args.action, args.query); return { notice: '已向电台发送指令；首次播放需要在电台面板点击播放。' }; },
  }), 'ai-radio: model tool');
  get('systemPrompt')?.section?.({ name: 'tool:ai-radio', text: '用户请求播放音乐电台、切歌或点歌时使用 ai_radio。首次音频播放需用户在电台面板点击播放。登录与歌单选择在电台设置中完成。', order: 118 });
}
