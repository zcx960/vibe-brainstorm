export interface ImagePreset {
  readonly id: string;
  readonly category: string;
  readonly label: string;
  readonly prompt: string;
}

export const IMAGE_PRESETS: readonly ImagePreset[] = [
  {
    id: 'character-sheet',
    category: '角色',
    label: '角色设定',
    prompt:
      '生成角色设定图：保留核心身份特征，包含正面半身、关键服装细节、配色说明和性格气质。',
  },
  {
    id: 'character-variation',
    category: '角色',
    label: '角色变体',
    prompt:
      '基于参考图做角色变体：保持人物身份和轮廓识别度，调整服装、姿态、光线与场景氛围。',
  },
  {
    id: 'storyboard',
    category: '分镜',
    label: '分镜脚本',
    prompt:
      '生成分镜脚本画面：电影感构图，清晰前景中景背景，强调镜头运动、角色动作和情绪转折。',
  },
  {
    id: 'comic-panel',
    category: '分镜',
    label: '漫画格',
    prompt:
      '生成漫画分格风格画面：强动作线、明确对白留白、戏剧化表情，画面叙事一眼可读。',
  },
  {
    id: 'keyframe',
    category: '影视',
    label: '关键帧',
    prompt:
      '生成影视关键帧：宽银幕比例感，精确光影，强视觉焦点，像电影暂停在最有张力的一秒。',
  },
  {
    id: 'scene-concept',
    category: '场景',
    label: '场景概念',
    prompt:
      '生成场景概念图：明确空间层次、时间天气、材质细节和人物尺度，适合作为美术设定参考。',
  },
  {
    id: 'product-shot',
    category: '商业',
    label: '产品静物',
    prompt:
      '生成产品静物图：干净布光，真实材质，高级商业摄影质感，突出主体功能和可触摸细节。',
  },
  {
    id: 'poster',
    category: '商业',
    label: '海报主视觉',
    prompt:
      '生成海报主视觉：强中心构图，标题留白区域，清晰视觉层级，适合活动、品牌或内容封面。',
  },
  {
    id: 'thumbnail',
    category: '封面',
    label: '内容封面',
    prompt:
      '生成内容封面图：高识别度主体，简洁背景，预留文字区域，缩略图尺寸下仍然清楚有冲击力。',
  },
  {
    id: 'style-board',
    category: '风格',
    label: '风格探索',
    prompt:
      '生成风格探索图：围绕同一主题尝试独特画风、配色、材质和镜头语言，整体保持统一方向。',
  },
  {
    id: 'material-sheet',
    category: '设定',
    label: '材质设定',
    prompt:
      '生成材质设定图：展示表面纹理、磨损、反光、透明度和细节特写，可作为后续资产制作参考。',
  },
  {
    id: 'mascot-logo',
    category: '品牌',
    label: '吉祥物',
    prompt:
      '生成品牌吉祥物或图标角色：轮廓简洁，表情有记忆点，适合延展到头像、贴纸和品牌周边。',
  },
] as const;
