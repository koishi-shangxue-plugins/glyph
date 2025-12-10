import { Context, Schema, Service } from 'koishi';
import { ref, watch } from '@vue/reactivity';
import { FSWatcher, watch as fsWatch } from 'node:fs';
import { readdir, readFile, stat, writeFile, mkdir, access, } from 'node:fs/promises';
import { resolve, extname, basename, dirname } from 'node:path';

export const name = 'glyph';
export const reusable = false;
export const filter = false;

export const inject = {
  required: ['http', 'logger'],
  optional: [],
};

export const usage = `
---

开启插件后，需要把字体文件放到 ./data/fonts 目录

重启koishi后，才能加载。

更多说明请查看readme

---
`;

// 支持的字体格式（包含所有常见的字体格式）
const SUPPORTED_FORMATS = [
  '.ttf',    // TrueType Font
  '.otf',    // OpenType Font
  '.woff',   // Web Open Font Format
  '.woff2',  // Web Open Font Format 2
  '.ttc',    // TrueType Collection
  '.eot',    // Embedded OpenType
  '.svg',    // SVG Font
  '.dfont',  // Mac OS X Data Fork Font
  '.fon',    // Windows Bitmap Font
  '.pfa',    // PostScript Type 1 Font (ASCII)
  '.pfb',    // PostScript Type 1 Font (Binary)
] as const;


// 字体信息接口
interface FontInfo {
  name: string;        // 字体文件名（不含扩展名）
  dataUrl: string;     // Base64 Data URL
  format: string;      // 字体格式
  size: number;        // 文件大小（字节）
}

// 声明 glyph 服务
declare module 'koishi' {
  interface Context {
    glyph: FontsService;
  }
}

// Fonts 服务类
export class FontsService extends Service {
  private fontMap: Map<string, FontInfo> = new Map();
  private fontRoot: string;
  public fontNames = ref<string[]>([]); // 响应式的字体名称列表
  private watcher: FSWatcher | null = null; // 文件监听器
  private debounceTimer: NodeJS.Timeout | null = null; // 防抖计时器

  constructor(ctx: Context, public config: FontsService.Config) {
    super(ctx, 'glyph', true);
    this.fontRoot = resolve(ctx.baseDir, config.root);
  }

  async start() {
    // 确保字体目录存在
    try {
      await mkdir(this.fontRoot, { recursive: true });
      this.ctx.logger.debug(`字体目录已就绪: ${this.fontRoot}`);
    } catch (err) {
      this.ctx.logger.warn(`创建字体目录失败: ${this.fontRoot}`, err);
      // 如果目录创建失败，则不进行后续操作
      return;
    }

    // 加载初始字体文件
    await this.loadFonts();
    this.ctx.logger.info(`已加载 ${this.fontMap.size} 个字体文件`);

    // 启动文件监听
    this.watcher = fsWatch(this.fontRoot, (eventType, filename) => {
      if (filename) {
        this.ctx.logger.info(`字体目录发生变化: ${filename} (${eventType})，重新加载字体列表...`);
        // 使用防抖，避免短时间内重复触发
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.loadFonts(), 200);
      }
    });
  }

  stop() {
    // 停止文件监听
    this.watcher?.close();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.ctx.logger.info('已停止字体目录监听');
  }

  // 加载字体目录中的所有字体文件
  private async loadFonts() {
    // 每次加载前清空旧数据
    this.fontMap.clear();
    try {
      const files = await readdir(this.fontRoot);

      for (const file of files) {
        const ext = extname(file).toLowerCase();

        // 只处理支持的字体格式
        if (!SUPPORTED_FORMATS.includes(ext as any)) {
          continue;
        }

        const filePath = resolve(this.fontRoot, file);
        const fileStats = await stat(filePath);

        // 跳过目录
        if (fileStats.isDirectory()) {
          continue;
        }

        try {
          // 获取字体名称（不含扩展名）
          const fontName = basename(file, ext);

          // 读取字体文件
          const buffer = await readFile(filePath);

          // 转换为 Base64 Data URL
          const base64 = buffer.toString('base64');
          const mimeType = this.getMimeType(ext);
          const dataUrl = `data:${mimeType};base64,${base64}`;

          // 存储字体信息
          const fontInfo: FontInfo = {
            name: fontName,
            dataUrl,
            format: ext.slice(1), // 去掉开头的点
            size: fileStats.size
          };

          this.fontMap.set(fontName, fontInfo);

          this.ctx.logger.debug(`已加载字体: ${fontName} (${ext}, ${(fileStats.size / 1024).toFixed(2)} KB)`);
        } catch (err) {
          this.ctx.logger.warn(`加载字体文件失败: ${file}`, err);
        }
      }
    } catch (err) {
      this.ctx.logger.warn(`读取字体目录失败: ${this.fontRoot}，将仅使用默认字体`, err);
    } finally {
      // 无论成功与否，都更新响应式列表
      const fontNames = Array.from(this.fontMap.keys());
      // 始终在列表开头添加“无”选项
      fontNames.unshift('无');
      this.fontNames.value = fontNames;
      this.ctx.logger.debug(`字体列表已更新，共 ${fontNames.length} 个选项`);
    }
  }

  // 获取字体的 MIME 类型
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttc': 'font/collection',
      '.eot': 'application/vnd.ms-fontobject',
      '.svg': 'image/svg+xml',
      '.dfont': 'application/x-dfont',
      '.fon': 'application/octet-stream',
      '.pfa': 'application/x-font-type1',
      '.pfb': 'application/x-font-type1'
    };
    return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
  }

  // 获取字体信息（可选的辅助方法）
  getFontInfo(name: string): FontInfo | undefined {
    return this.fontMap.get(name);
  }

  // 获取所有字体名称列表
  // 获取所有字体名称列表
  getFontNames(): string[] {
    return this.fontNames.value;
  }

  // 根据名称获取字体 Data URL
  getFontDataUrl(name: string): string | undefined {
    return this.fontMap.get(name)?.dataUrl;
  }

  /**
   * 检查字体是否存在，如果不存在则从指定 URL 下载
   * @param fontName 字体名称（不含扩展名）
   * @param downloadUrl 字体文件的下载 URL
   * @returns 如果字体已存在返回 true，下载成功后也返回 true，失败返回 false
   */
  async checkFont(fontName: string, downloadUrl: string): Promise<boolean> {
    // “无”是一个虚拟字体，永远被认为是存在的
    if (fontName === '无') {
      return true;
    }
    // 先检查内存中是否已加载
    if (this.fontMap.has(fontName)) {
      this.ctx.logger.debug(`字体已在内存中: ${fontName}`);
      return true;
    }

    // 检查文件系统中是否存在该字体文件（任意支持的格式）
    for (const ext of SUPPORTED_FORMATS) {
      const filePath = resolve(this.fontRoot, `${fontName}${ext}`);
      try {
        await access(filePath);
        // 文件存在，加载到内存
        this.ctx.logger.debug(`字体文件已存在，加载到内存: ${fontName}${ext}`);
        await this.loadSingleFont(filePath);
        return true;
      } catch {
        // 文件不存在，继续检查下一个格式
      }
    }

    // 文件不存在，开始下载
    this.ctx.logger.info(`字体不存在，开始下载: ${fontName} from ${downloadUrl}`);

    try {
      // 使用 ctx.http.file 下载字体文件
      const response = await this.ctx.http.file(downloadUrl);

      // 从 MIME 类型推断文件扩展名
      const ext = this.getExtensionFromMimeType(response.type);
      if (!ext) {
        this.ctx.logger.warn(`不支持的字体 MIME 类型: ${response.type}`);
        return false;
      }

      // 构建保存路径
      const fileName = `${fontName}${ext}`;
      const filePath = resolve(this.fontRoot, fileName);

      // 确保目录存在
      await mkdir(dirname(filePath), { recursive: true });

      // 将 ArrayBuffer 转换为 Buffer 并保存文件
      const buffer = Buffer.from(response.data);
      await writeFile(filePath, buffer);

      this.ctx.logger.info(`字体下载成功: ${fileName} (${(buffer.length / 1024).toFixed(2)} KB)`);

      // 转换为 Base64 Data URL
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${response.type};base64,${base64}`;

      // 存储字体信息到内存
      const fontInfo: FontInfo = {
        name: fontName,
        dataUrl,
        format: ext.slice(1), // 去掉开头的点
        size: buffer.length
      };

      this.fontMap.set(fontName, fontInfo);
      // 更新响应式字体列表
      this.fontNames.value = Array.from(this.fontMap.keys());

      this.ctx.logger.info(`字体已加载到内存: ${fontName}`);
      return true;
    } catch (err) {
      this.ctx.logger.error(`下载字体失败: ${fontName}`, err);
      return false;
    }
  }

  // 加载单个字体文件到内存
  private async loadSingleFont(filePath: string): Promise<void> {
    const file = basename(filePath);
    const ext = extname(file).toLowerCase();
    const fontName = basename(file, ext);

    try {
      const fileStats = await stat(filePath);
      const buffer = await readFile(filePath);

      // 转换为 Base64 Data URL
      const base64 = buffer.toString('base64');
      const mimeType = this.getMimeType(ext);
      const dataUrl = `data:${mimeType};base64,${base64}`;

      // 存储字体信息
      const fontInfo: FontInfo = {
        name: fontName,
        dataUrl,
        format: ext.slice(1),
        size: fileStats.size
      };

      this.fontMap.set(fontName, fontInfo);
      // 更新响应式字体列表
      this.fontNames.value = Array.from(this.fontMap.keys());
      this.ctx.logger.debug(`已加载字体: ${fontName} (${ext}, ${(fileStats.size / 1024).toFixed(2)} KB)`);
    } catch (err) {
      this.ctx.logger.warn(`加载字体文件失败: ${file}`, err);
      throw err;
    }
  }

  // 从 MIME 类型获取文件扩展名
  private getExtensionFromMimeType(mimeType: string): string | null {
    const mimeToExt: Record<string, string> = {
      'font/ttf': '.ttf',
      'font/otf': '.otf',
      'font/woff': '.woff',
      'font/woff2': '.woff2',
      'font/collection': '.ttc',
      'application/vnd.ms-fontobject': '.eot',
      'image/svg+xml': '.svg',
      'application/x-dfont': '.dfont',
      'application/octet-stream': '.ttf', // 默认使用 ttf
      'application/x-font-type1': '.pfa'
    };
    return mimeToExt[mimeType] || null;
  }
}

export namespace FontsService {
  export interface Config {
    root: string;
    fontPreview: string;
  }

  export const Config: Schema<Config> = Schema.object({
    root: Schema.path({
      filters: ['directory'],
      allowCreate: true,
    })
      .default('data/fonts')
      .description('存放字体文件的目录路径'),

    fontPreview: Schema.dynamic('glyph.fonts')
      .description(`字体列表展示<br>**此列表会自动监听字体目录的变化并实时更新**<br>> 用于预览所有可用字体，无实际功能`)
  });
}

// 导出配置
export const Config = FontsService.Config;

// 应用插件
export function apply(ctx: Context, config: FontsService.Config) {
  // 注册 glyph 服务
  ctx.plugin(FontsService, config);

  // 使用 ctx.inject 确保在 glyph 服务可用后再执行监听逻辑
  ctx.inject(['glyph'], (ctx) => {
    // 监听响应式字体列表的变化，并更新 Schema
    const schemaWatcher = watch(ctx.glyph.fontNames, (names) => {
      // 如果 names 为空或未定义，Schema.union([]) 会创建一个 Schema.never()，这会隐藏配置项，行为正确
      ctx.schema.set('glyph.fonts', Schema.union(names || []));
    }, { immediate: true });

    // 在插件卸载时停止所有监听
    ctx.effect(() => {
      // 返回一个函数，该函数将执行所有清理操作
      return () => {
        schemaWatcher.stop();
        ctx.glyph.stop(); // 停止文件监听
      };
    });
  });
}
