/**
 * Server-side i18n for studio messages.
 *
 * The server sends messages to the client via SSE text chunks and JSON cards.
 * This module resolves those messages based on the user's locale.
 *
 * Usage:
 *   import { st } from './server-i18n.js';
 *   st(locale, 'progress.storyboard_done', { n: 3, intent: 'promo' })
 *
 * Locale resolution:
 *   1. Client sends locale via query param or X-Locale header
 *   2. Server defaults to 'en' if not provided
 */

export type Locale = 'en' | 'zh';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ParamFn = (...args: any[]) => string;
type DictEntry = string | ParamFn;

const DICT: Record<Locale, Record<string, DictEntry>> = {
  en: {
    // ---- Progress messages (SSE text chunks) ----
    'progress.restyle_all': (n: number) => `🎨 Keeping copy, redoing all ${n} frames with new style…\n`,
    'progress.regen_all': (n: number) => `🔄 Redoing all ${n} frames with new content (manually edited frames will be overwritten)…\n`,
    'progress.empty_retry': '\n↻ First output was empty, retrying…\n',
    'progress.keep_existing': (n: number) => `✓ Keeping existing copy: ${n} frames`,
    'progress.planning': (n: number) => `📋 Planning ${n}-frame storyboard…`,
    'progress.storyboard_done': (n: number, intent: string) => `✓ Storyboard ready: ${n} frames (${intent})`,
    'progress.generating_frame': (i: number, total: number, nodeId: string) => `🎬 Generating frame ${i + 1}/${total} (${nodeId})…`,
    'progress.frame_empty_retry': (i: number) => `  ↻ Frame ${i + 1} first attempt empty, retrying…`,
    'progress.frame_done': (i: number, total: number, nodeId: string) => `  ✓ Frame ${i + 1}/${total} done (${nodeId})`,

    // ---- Edit menu card ----
    'card.edit.question': 'What would you like to change?',
    'card.edit.style.label': '🎨 Change style',
    'card.edit.style.hint': 'Keep content, apply a new visual style',
    'card.edit.content.label': '✏️ Change content',
    'card.edit.content.hint': 'Change copy / topic / rewrite script',
    'card.edit.duration.label': '⏱️ Change duration',
    'card.edit.duration.hint': 'Adjust per-frame timing / pacing',

    // ---- Type picker card ----
    'card.type.question': 'What type of content?',
    'card.type.single.label': 'Single title card',
    'card.type.single.hint': 'Logo / cover / single still - 5-10s',
    'card.type.multi.label': 'Multi-frame teaser',
    'card.type.multi.hint': 'Product / event teaser, 3-6 frames',
    'card.type.data.label': 'Data poster',
    'card.type.data.hint': '1-2 key numbers, social media bold style',
    'card.type.explainer.label': 'Concept explainer',
    'card.type.explainer.hint': 'A few frames to explain an idea / feature',

    // ---- Style picker card ----
    'card.style.question': 'How about the visual style?',
    'card.style.cyber.hint': 'Neon / glitch / high contrast',
    'card.style.swiss.hint': 'Grid / sans-serif / whitespace',
    'card.style.warm.hint': 'Paper texture / serif / warm tones',
    'card.style.brutal.hint': 'Black & white / blocky / bold',
    'card.style.from_template': 'Pick from design template',
    'card.style.from_template.hint': 'Choose a ready-made template above',

    // ---- Need template card ----
    'card.need_template.question': 'Pick a template from the top bar first, then click continue below; or choose a built-in style:',
    'card.need_template.ready.label': 'I picked a template, continue',
    'card.need_template.ready.hint': 'Generate using the selected template',

    // ---- Format card ----
    'format.title_edit': 'Change format',
    'format.title_multi': 'Final step: Size / per-frame duration / frame count',
    'format.title_single': 'Final step: Pick a size / duration',
    'format.aspect.label': 'Aspect ratio',
    'format.aspect.16:9': '16:9 Landscape',
    'format.aspect.9:16': '9:16 Portrait',
    'format.aspect.1:1': '1:1 Square',
    'format.aspect.4:5': '4:5 Social',
    'format.per_frame.label': 'Per-frame duration (sec)',
    'format.per_frame.hint': 'Total = per-frame × frame count',
    'format.frame_count.label': 'Frame count',
    'format.duration.label': 'Duration (sec)',

    // ---- Confirm card ----
    'confirm.title': 'Generate with this info?',
    'confirm.label.type': 'Type',
    'confirm.label.content': 'Content',
    'confirm.label.style': 'Style',
    'confirm.label.template': 'Template',
    'confirm.label.aspect': 'Size',
    'confirm.label.duration': 'Duration',
    'confirm.label.frame_count': 'Frames',
    'confirm.label.per_frame': 'Per-frame',
    'confirm.label.total': 'Total',
    'confirm.label.attachments': 'Assets',

    // ---- Aspect values (used as both value and label) ----
    'aspect.16:9': '16:9 Landscape',
    'aspect.9:16': '9:16 Portrait',
    'aspect.1:1': '1:1 Square',
    'aspect.4:5': '4:5 Social',
  },

  zh: {
    // ---- Progress messages (SSE text chunks) ----
    'progress.restyle_all': (n: number) => `🎨 沿用文案，按新风格重做全部 ${n} 帧…\n`,
    'progress.regen_all': (n: number) => `🔄 基于新内容重做全部 ${n} 帧（已手动修改过的帧会被覆盖）…\n`,
    'progress.empty_retry': '\n↻ 第一次输出为空，重试中…\n',
    'progress.keep_existing': (n: number) => `✓ 沿用现有文案：${n} 帧`,
    'progress.planning': (n: number) => `📋 规划 ${n} 帧的故事板…`,
    'progress.storyboard_done': (n: number, intent: string) => `✓ 故事板规划完成：${n} 帧 (${intent})`,
    'progress.generating_frame': (i: number, total: number, nodeId: string) => `🎬 生成第 ${i + 1}/${total} 帧 (${nodeId})…`,
    'progress.frame_empty_retry': (i: number) => `  ↻ 第 ${i + 1} 帧首试为空，重试…`,
    'progress.frame_done': (i: number, total: number, nodeId: string) => `  ✓ 第 ${i + 1}/${total} 帧完成 (${nodeId})`,

    // ---- Edit menu card ----
    'card.edit.question': '想改哪方面？',
    'card.edit.style.label': '🎨 换风格',
    'card.edit.style.hint': '保留内容，换一套视觉风格',
    'card.edit.content.label': '✏️ 改内容',
    'card.edit.content.hint': '改文案 / 主题 / 重写脚本',
    'card.edit.duration.label': '⏱️ 改时长',
    'card.edit.duration.hint': '调整每帧时长 / 节奏',

    // ---- Type picker card ----
    'card.type.question': '想做哪种内容？',
    'card.type.single.label': '单帧标题卡',
    'card.type.single.hint': 'logo / 封面 / 单画面 - 5-10s',
    'card.type.multi.label': '多帧预告片',
    'card.type.multi.hint': '产品 / 活动 teaser, 3-6 帧',
    'card.type.data.label': '数据大字报',
    'card.type.data.hint': '1-2 个核心数字, 社媒爆款风',
    'card.type.explainer.label': '概念解说短片',
    'card.type.explainer.hint': '几帧讲清一个 idea / feature',

    // ---- Style picker card ----
    'card.style.question': '视觉风格怎么定？',
    'card.style.cyber.hint': '霓虹 / 故障感 / 高对比',
    'card.style.swiss.hint': '网格 / 无衬线 / 留白',
    'card.style.warm.hint': '纸感 / 衬线 / 暖色',
    'card.style.brutal.hint': '黑白 / 块状 / 粗体',
    'card.style.from_template': '从设计模板选',
    'card.style.from_template.hint': '上方挑一个现成模板',

    // ---- Need template card ----
    'card.need_template.question': '先在顶部「模板」里选一个模板，选好后点下面继续；或直接选一种内置风格：',
    'card.need_template.ready.label': '我已选好模板，继续',
    'card.need_template.ready.hint': '用顶部选中的模板生成',

    // ---- Format card ----
    'format.title_edit': '改一下格式',
    'format.title_multi': '最后一步：尺寸 / 每帧时长 / 帧数',
    'format.title_single': '最后一步：选个尺寸 / 时长',
    'format.aspect.label': '画面尺寸',
    'format.aspect.16:9': '16:9 横屏',
    'format.aspect.9:16': '9:16 竖屏',
    'format.aspect.1:1': '1:1 方形',
    'format.aspect.4:5': '4:5 小红书',
    'format.per_frame.label': '每帧时长 (秒)',
    'format.per_frame.hint': '总时长 = 每帧时长 × 帧数',
    'format.frame_count.label': '帧数',
    'format.duration.label': '时长 (秒)',

    // ---- Confirm card ----
    'confirm.title': '按这些信息生成？',
    'confirm.label.type': '类型',
    'confirm.label.content': '内容',
    'confirm.label.style': '风格',
    'confirm.label.template': '模板',
    'confirm.label.aspect': '尺寸',
    'confirm.label.duration': '时长',
    'confirm.label.frame_count': '帧数',
    'confirm.label.per_frame': '每帧时长',
    'confirm.label.total': '总时长',
    'confirm.label.attachments': '素材',

    // ---- Aspect values (used as both value and label) ----
    'aspect.16:9': '16:9 横屏',
    'aspect.9:16': '9:16 手机竖屏',
    'aspect.1:1': '1:1 方形',
    'aspect.4:5': '4:5 小红书',
  },
};

/**
 * Resolve a server-side translation key.
 *
 * @param locale - The user's locale ('en' or 'zh')
 * @param key - The translation key
 * @param params - Optional parameters for dynamic strings
 * @returns The translated string, falling back to English, then the key itself
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function st(locale: string, key: string, ...params: any[]): string {
  const loc = (locale === 'zh' ? 'zh' : 'en') as Locale;
  const entry = DICT[loc]?.[key] ?? DICT.en[key];

  if (entry === undefined) {
    return key;
  }

  if (typeof entry === 'function') {
    return entry(...params);
  }

  return entry;
}

/**
 * Get the default aspect value for a locale.
 */
export function aspectValue(locale: string, aspect: '16:9' | '9:16' | '1:1' | '4:5'): string {
  return st(locale, `aspect.${aspect}`);
}
