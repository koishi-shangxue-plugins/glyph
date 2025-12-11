import { Context, Logger } from 'koishi';
import { DataService } from '@koishijs/console';
import { readdir, stat, writeFile, unlink } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { FontsService } from './index';

import type { } from '@koishijs/console';
const logger = new Logger(`glyph`);
// 扩展Console类型声明
declare module '@koishijs/console' {
  namespace Console {
    interface Services {
      glyph: GlyphProvider;
    }
  }

  interface Events {
    'glyph/delete'(fontName: string): void;
    'glyph/upload'(fileName: string, base64Data: string): void;
    'glyph/load-font'(fontName: string): Promise<string | null>;
    'glyph/unload-font'(fontName: string): void;
    'glyph/unload-all'(): void;
    'glyph/get-memory-info'(): Promise<Array<{ name: string; size: number }>>;
  }
}

// 支持的字体格式
const SUPPORTED_FORMATS = [
  '.ttf', '.otf', '.woff', '.woff2', '.ttc',
  '.eot', '.svg', '.dfont', '.fon', '.pfa', '.pfb'
] as const;

// 字体信息接口
export interface GlyphFont {
  name: string;        // 字体文件名（不含扩展名）
  fileName: string;    // 完整文件名
  format: string;      // 字体格式
  size: number;        // 文件大小（字节）
  path: string;        // 文件路径
  dataUrl?: string;    // Base64 Data URL（用于预览）
}

// Provider数据结构
export interface GlyphPayload {
  fonts: GlyphFont[];
}

// Provider服务类
export class GlyphProvider extends DataService<GlyphPayload> {
  constructor(
    ctx: Context,
    private glyphService: FontsService
  ) {
    super(ctx, 'glyph');

    // 监听删除字体事件
    ctx.console.addListener('glyph/delete', async (fontName: string) => {
      await this.deleteFont(fontName);
      await this.refresh();
    });

    // 监听上传字体事件
    ctx.console.addListener('glyph/upload', async (fileName: string, base64Data: string) => {
      await this.uploadFont(fileName, base64Data);
      // 等待文件系统监听器触发并重新加载字体
      await new Promise(resolve => setTimeout(resolve, 300));
      await this.refresh();
    });

    // 监听按需加载字体事件
    ctx.console.addListener('glyph/load-font', async (fontName: string) => {
      return await this.loadFontOnDemand(fontName);
    });

    // 监听释放单个字体事件
    ctx.console.addListener('glyph/unload-font', (fontName: string) => {
      this.glyphService.unloadFont(fontName);
    });

    // 监听释放所有字体事件
    ctx.console.addListener('glyph/unload-all', () => {
      this.glyphService.unloadAllFonts();
    });

    // 监听获取内存信息事件
    ctx.console.addListener('glyph/get-memory-info', async () => {
      return this.glyphService.getMemoryInfo();
    });
  }

  // 获取字体列表数据
  async get(): Promise<GlyphPayload> {
    const fonts = await this.listFonts();
    return { fonts };
  }

  // 列出所有字体文件
  private async listFonts(): Promise<GlyphFont[]> {
    const fonts: GlyphFont[] = [];
    const fontRoot = this.glyphService['fontRoot'];

    try {
      const files = await readdir(fontRoot);

      for (const file of files) {
        const ext = extname(file).toLowerCase();

        // 只处理支持的字体格式
        if (!SUPPORTED_FORMATS.includes(ext as typeof SUPPORTED_FORMATS[number])) {
          continue;
        }

        const filePath = resolve(fontRoot, file);
        const fileStats = await stat(filePath);

        // 跳过目录
        if (fileStats.isDirectory()) {
          continue;
        }

        const fontName = basename(file, ext);
        const fontInfo = this.glyphService.getFontInfo(fontName);

        fonts.push({
          name: fontName,
          fileName: file,
          format: ext.slice(1),
          size: fileStats.size,
          path: filePath,
          dataUrl: fontInfo?.dataUrl
        });
      }
    } catch (err) {
      logger.error('读取字体目录失败', err);
    }

    return fonts;
  }

  // 删除字体文件
  private async deleteFont(fontName: string): Promise<void> {
    const fontRoot = this.glyphService['fontRoot'];

    try {
      // 查找所有匹配的字体文件
      const files = await readdir(fontRoot);
      const matchingFiles = files.filter(file => {
        const ext = extname(file).toLowerCase();
        const name = basename(file, ext);
        return name === fontName && SUPPORTED_FORMATS.includes(ext as typeof SUPPORTED_FORMATS[number]);
      });

      // 删除所有匹配的文件
      for (const file of matchingFiles) {
        const filePath = resolve(fontRoot, file);
        await unlink(filePath);
        logger.info(`已删除字体文件: ${file}`);
      }
    } catch (err) {
      logger.error(`删除字体失败: ${fontName}`, err);
      throw err;
    }
  }

  // 上传字体文件
  private async uploadFont(fileName: string, base64Data: string): Promise<void> {
    const fontRoot = this.glyphService['fontRoot'];

    try {
      // 验证文件扩展名
      const ext = extname(fileName).toLowerCase();
      if (!SUPPORTED_FORMATS.includes(ext as typeof SUPPORTED_FORMATS[number])) {
        throw new Error(`不支持的字体格式: ${ext}`);
      }

      // 解析base64数据
      const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        throw new Error('无效的base64数据格式');
      }

      const base64Content = matches[2];
      const buffer = Buffer.from(base64Content, 'base64');

      // 保存文件
      const filePath = resolve(fontRoot, fileName);
      await writeFile(filePath, buffer);

      logger.info(`字体文件上传成功: ${fileName} (${(buffer.length / 1024).toFixed(2)} KB)`);

      // 立即加载新上传的字体到内存，确保前端可以立即预览
      const fontName = basename(fileName, ext);
      await this.glyphService['loadSingleFont'](filePath);
      logger.info(`字体已加载到内存: ${fontName}`);
    } catch (err) {
      logger.error(`上传字体失败: ${fileName}`, err);
      throw err;
    }
  }

  // 按需加载字体到内存
  private async loadFontOnDemand(fontName: string): Promise<string | null> {
    try {
      // 检查是否已在内存中
      const fontInfo = this.glyphService.getFontInfo(fontName);
      if (fontInfo?.dataUrl) {
        logger.debug(`字体已在内存中: ${fontName}`);
        return fontInfo.dataUrl;
      }

      // 查找字体文件
      const fontRoot = this.glyphService['fontRoot'];
      const files = await readdir(fontRoot);

      for (const file of files) {
        const ext = extname(file).toLowerCase();
        const name = basename(file, ext);

        if (name === fontName && SUPPORTED_FORMATS.includes(ext as typeof SUPPORTED_FORMATS[number])) {
          const filePath = resolve(fontRoot, file);

          // 加载字体到内存
          await this.glyphService['loadSingleFont'](filePath);
          logger.info(`按需加载字体: ${fontName}`);

          // 返回dataUrl
          const loadedFont = this.glyphService.getFontInfo(fontName);
          return loadedFont?.dataUrl || null;
        }
      }

      logger.warn(`未找到字体文件: ${fontName}`);
      return null;
    } catch (err) {
      logger.error(`按需加载字体失败: ${fontName}`, err);
      return null;
    }
  }
}