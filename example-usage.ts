/**
 * 这是一个示例文件，展示其他插件如何使用 koishi-plugin-glyph
 *
 * 使用方法：
 * 1. 将 koishi-plugin-glyph 添加到 devDependencies (仅用于获取类型)
 ```json
   "devDependencies": {
    "koishi": "^4.18.0",
    "koishi-plugin-glyph": "^3.0.0"
  }
 ```
 * 2. 使用 Schema.dynamic('glyph.fonts') 引用字体列表
 * 3. 使用 inject 声明 glyph 服务
 * 4. 通过 ctx.glyph.getFontDataUrl(config.font) 获取字体的 Base64 Data URL
 * 5. 可以使用 ctx.glyph.checkFont() 自动下载并加载字体（可选）
 *
 * 重要提示：
 * - 动态配置项在 yarn dev 开发模式下不会显示选项列表
 * - 在 yarn start 生产模式下可以正常看到并选择字体
 */

import { Context, Schema } from 'koishi';
import type { } from 'koishi-plugin-glyph';

export const name = 'example-plugin';

// 声明依赖
export const inject = {
  required: ['glyph']
};

export interface Config {
  font: string;
  text: string;
}

export const Config: Schema<Config> = Schema.object({
  // 使用 Schema.dynamic('glyph.fonts') 引用 glyph 服务提供的动态字体列表
  // 配置项的值是字体名称，不是 Data URL
  // 再次提示： 动态配置项在 yarn dev 开发模式下不会显示选项列表
  font: Schema.dynamic('glyph.fonts').description('选择要使用的字体'),

  text: Schema.string().default('Hello World').description('要渲染的文本')
});

export function apply(ctx: Context, config: Config) {
  /**
   * 在插件启动时检查并下载所需字体（可选）
   * **********************************************************************
   */
  ctx.on('ready', async () => {
    // 示例：检查并下载 Noto Color Emoji 字体
    const fontExists = await ctx.glyph.checkFont(
      'NotoColorEmoji-Regular',
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/fonts/NotoColorEmoji.ttf'
    );

    if (fontExists) {
      ctx.logger.info('字体已准备就绪: NotoColorEmoji-Regular');
    } else {
      ctx.logger.warn('字体下载失败: NotoColorEmoji-Regular');
    }
  });
  /**
   * **********************************************************************
   */

  ctx.command('test-font')
    .action(async ({ session }) => {
      // 如果没有选择字体，使用第一个可用字体
      const selectedFont = config.font || ctx.glyph.getFontNames()[0];

      if (!selectedFont) {
        return '没有可用的字体';
      }

      // config.font 是字体名称，需要通过 glyph 服务获取 Data URL
      const fontDataUrl = ctx.glyph.getFontDataUrl(selectedFont);

      if (!fontDataUrl) {
        return `未找到字体: ${selectedFont}`;
      }

      ctx.logger.info('选中的字体:', selectedFont);
      ctx.logger.info('字体 Data URL 长度:', fontDataUrl.length);

      // 现在可以在 HTML/CSS 中使用这个 Data URL
      // 例如在生成图片时：
      const fontFace = `
        @font-face {
          font-family: 'CustomFont';
          src: url('${fontDataUrl}');
        }
      `;

      // 或者在 Canvas 中使用
      // 或者传递给图片生成库等

      return `字体已加载: ${selectedFont}，文本: ${config.text}`;
    });
}
