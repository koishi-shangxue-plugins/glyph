import { Context, Schema, Service } from 'koishi';
import { ref, watch } from '@vue/reactivity';
import { FSWatcher, watch as fsWatch, readFileSync, statSync, readdirSync } from 'node:fs';
import { readdir, readFile, stat, writeFile, mkdir, access, unlink } from 'node:fs/promises';
import { resolve, extname, basename, dirname } from 'node:path';
import { GlyphProvider } from './page';

import type { } from '@koishijs/console';

export const name = 'glyph';
export const reusable = false;
export const filter = false;

export const inject = {
  required: ['http', 'logger'],
  optional: ['console'],
};

export const usage = `
---

## 字体加载

本插件会自动监听并加载 **./data/fonts** 目录下的字体文件。

- **添加字体**: 将字体文件放入该目录，插件会自动识别并添加到配置列表中。
- **删除字体**: 从目录中移除字体文件，配置列表也会同步更新。

更多说明请查看 Readme。

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
  lastAccess: number;  // 最后访问时间戳
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
  private cleanupTimer: NodeJS.Timeout | null = null; // 内存清理计时器
  private readonly CLEANUP_INTERVAL = 30 * 1000; // 30秒清理一次

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
      this.ctx.logger.error(`创建字体目录失败: ${this.fontRoot}`, err);
      // 如果目录创建失败，则不进行后续操作
      return;
    }

    // 只加载字体列表，不加载字体内容到内存
    await this.loadFontNames();
    this.ctx.logger.debug(`已扫描 ${this.fontNames.value.length} 个字体文件`);

    // 延迟触发 Schema 更新（通过文件系统变化触发）
    setTimeout(async () => {
      await this.triggerSchemaUpdate();
    }, 1000);

    // 启动文件监听
    this.watcher = fsWatch(this.fontRoot, (eventType, filename) => {
      if (filename) {
        this.ctx.logger.debug(`字体目录发生变化: ${filename} (${eventType})，重新加载字体列表...`);
        // 使用防抖，避免短时间内重复触发
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.loadFontNames(), 200);
      }
    });

    // 启动内存清理定时器
    this.cleanupTimer = setInterval(() => {
      this.cleanupUnusedFonts();
    }, this.CLEANUP_INTERVAL);

    this.ctx.logger.debug(`字体内存管理已启动，TTL: ${this.config.fontTTL} 分钟`);
  }

  // 更新 Schema（供内部和外部调用）
  private updateSchema() {
    const finalNames = this.fontNames.value || [];
    // 如果只有两个"无"选项，则将它们渲染为 Schema.const
    if (finalNames.length === 2 && finalNames[0] === '无' && finalNames[1].trim() === '无') {
      this.ctx.schema.set('glyph.fonts', Schema.union([
        Schema.const('无').description('无'),
        Schema.const('无 ').description('请将字体文件放入koishi的 ./data/fonts 文件夹下'),
      ]));
    } else {
      // 否则，正常渲染列表
      this.ctx.schema.set('glyph.fonts', Schema.union(finalNames));
    }
  }

  // 通过文件系统变化触发 Schema 更新
  private async triggerSchemaUpdate() {
    const dummyFile = resolve(this.fontRoot, '.schema-trigger.tmp');
    try {
      // 创建临时文件
      await writeFile(dummyFile, '');
      // 立即删除
      await unlink(dummyFile);
      this.ctx.logger.debug('已通过文件系统变化触发 Schema 更新');
    } catch (err) {
      // 如果失败，回退到直接更新
      this.ctx.logger.debug('文件系统触发失败，使用直接更新');
      this.updateSchema();
    }
  }

  stop() {
    // 停止文件监听
    this.watcher?.close();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.ctx.logger.debug('已停止字体目录监听和内存清理');
  }

  // 只加载字体名称列表，不加载字体内容
  private async loadFontNames() {
    const fontNames: string[] = [];
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

        // 获取字体名称（不含扩展名）
        const fontName = basename(file, ext);
        fontNames.push(fontName);
      }
    } catch (err) {
      this.ctx.logger.error(`读取字体目录失败: ${this.fontRoot}`, err);
    } finally {
      // 更新响应式列表
      if (fontNames.length === 0) {
        this.fontNames.value = ['无', '无 '];
      } else {
        fontNames.unshift('无');
        this.fontNames.value = fontNames;
      }
      this.ctx.logger.debug(`字体列表已更新，共 ${this.fontNames.value.length} 个选项`);
    }
  }

  // 清理长时间未使用的字体
  private cleanupUnusedFonts() {
    const now = Date.now();
    const ttl = this.config.fontTTL * 60 * 1000; // 转换为毫秒
    const toDelete: string[] = [];

    for (const [name, info] of this.fontMap.entries()) {
      if (now - info.lastAccess > ttl) {
        toDelete.push(name);
      }
    }

    if (toDelete.length > 0) {
      for (const name of toDelete) {
        this.fontMap.delete(name);
      }
      this.ctx.logger.debug(`已清理 ${toDelete.length} 个超过 ${this.config.fontTTL} 分钟未使用的字体: ${toDelete.join(', ')}`);
    }
  }

  // 立即释放指定字体的内存
  unloadFont(fontName: string): void {
    if (this.fontMap.has(fontName)) {
      this.fontMap.delete(fontName);
      this.ctx.logger.debug(`已释放字体内存: ${fontName}`);
    }
  }

  // 立即释放所有字体的内存
  unloadAllFonts(): void {
    const count = this.fontMap.size;
    if (count > 0) {
      this.fontMap.clear();
      this.ctx.logger.debug(`已释放所有字体内存，共 ${count} 个字体`);
    }
  }

  // 获取当前内存中的字体信息
  getMemoryInfo(): Array<{ name: string; size: number }> {
    const info: Array<{ name: string; size: number }> = [];
    for (const [name, fontInfo] of this.fontMap.entries()) {
      info.push({
        name,
        size: fontInfo.size
      });
    }
    return info;
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
            size: fileStats.size,
            lastAccess: Date.now()
          };

          this.fontMap.set(fontName, fontInfo);

          this.ctx.logger.debug(`已加载字体: ${fontName} (${ext}, ${(fileStats.size / 1024).toFixed(2)} KB)`);
        } catch (err) {
          this.ctx.logger.error(`加载字体文件失败: ${file}`, err);
        }
      }
    } catch (err) {
      this.ctx.logger.error(`读取字体目录失败: ${this.fontRoot}，将仅使用默认字体`, err);
    } finally {
      // 无论成功与否，都更新响应式列表
      const fontNames = Array.from(this.fontMap.keys());

      // 如果没有实际字体，则添加两个“无”选项以强制显示下拉框
      if (fontNames.length === 0) {
        this.fontNames.value = ['无', '无 ']; // 使用一个带空格的“无”作为第二个唯一值
      } else {
        // 否则，在列表开头添加一个“无”选项
        fontNames.unshift('无');
        this.fontNames.value = fontNames;
      }
      this.ctx.logger.debug(`字体列表已更新，共 ${this.fontNames.value.length} 个选项`);
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
    const info = this.fontMap.get(name);
    if (info) {
      // 更新最后访问时间
      info.lastAccess = Date.now();
    }
    return info;
  }

  // 获取所有字体名称列表
  // 获取所有字体名称列表
  getFontNames(): string[] {
    return this.fontNames.value;
  }

  // 根据名称获取字体 Data URL
  getFontDataUrl(name: string): string | undefined {
    // 检查是否已在内存中
    let fontInfo = this.fontMap.get(name);
    if (fontInfo) {
      // 更新最后访问时间
      fontInfo.lastAccess = Date.now();
      return fontInfo.dataUrl;
    }

    // 不在内存中，尝试同步加载
    this.ctx.logger.debug(`字体不在内存中，同步加载: ${name}`);

    try {
      const files = readdirSync(this.fontRoot);

      for (const file of files) {
        const ext = extname(file).toLowerCase();
        const fontName = basename(file, ext);

        if (fontName === name && SUPPORTED_FORMATS.includes(ext as any)) {
          const filePath = resolve(this.fontRoot, file);

          // 同步加载字体
          try {
            const fileStats = statSync(filePath);
            const buffer = readFileSync(filePath);

            // 转换为 Base64 Data URL
            const base64 = buffer.toString('base64');
            const mimeType = this.getMimeType(ext);
            const dataUrl = `data:${mimeType};base64,${base64}`;

            // 存储字体信息
            fontInfo = {
              name: fontName,
              dataUrl,
              format: ext.slice(1),
              size: fileStats.size,
              lastAccess: Date.now()
            };

            this.fontMap.set(fontName, fontInfo);
            this.ctx.logger.debug(`已同步加载字体: ${fontName} (${ext}, ${(fileStats.size / 1024).toFixed(2)} KB)`);

            return dataUrl;
          } catch (err) {
            this.ctx.logger.error(`同步加载字体文件失败: ${file}`, err);
            return undefined;
          }
        }
      }

      this.ctx.logger.warn(`未找到字体文件: ${name}`);
      return undefined;
    } catch (err) {
      this.ctx.logger.error(`同步加载字体失败: ${name}`, err);
      return undefined;
    }
  }

  /**
   * 检查字体是否存在，如果不存在则从指定 URL 下载
   * @param fontName 字体名称（不含扩展名）
   * @param downloadUrl 字体文件的下载 URL
   * @returns 如果字体已存在返回 true，下载成功后也返回 true，失败返回 false
   */
  async checkFont(fontName: string, downloadUrl: string): Promise<boolean> {
    // "无"是一个虚拟字体，永远被认为是存在的
    if (fontName?.trim() === '无') {
      return true;
    }

    // 先检查内存中是否已加载
    const fontInfo = this.fontMap.get(fontName);
    if (fontInfo) {
      // 更新最后访问时间
      fontInfo.lastAccess = Date.now();
      this.ctx.logger.debug(`字体已在内存中: ${fontName}`);
      return true;
    }

    // 检查文件系统中是否存在该字体文件（任意支持的格式）
    for (const ext of SUPPORTED_FORMATS) {
      const filePath = resolve(this.fontRoot, `${fontName}${ext}`);
      try {
        await access(filePath);
        // 文件存在，按需加载到内存
        this.ctx.logger.debug(`字体文件已存在: ${fontName}${ext}`);
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
        size: buffer.length,
        lastAccess: Date.now()
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

  // 加载单个字体文件到内存（公共方法，供 GlyphProvider 调用）
  async loadSingleFont(filePath: string): Promise<void> {
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
        size: fileStats.size,
        lastAccess: Date.now()
      };

      this.fontMap.set(fontName, fontInfo);
      // 更新响应式字体列表
      this.fontNames.value = Array.from(this.fontMap.keys());
      this.ctx.logger.debug(`已加载字体: ${fontName} (${ext}, ${(fileStats.size / 1024).toFixed(2)} KB)`);
    } catch (err) {
      this.ctx.logger.error(`加载字体文件失败: ${file}`, err);
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
    fontTTL: number;
  }

  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      root: Schema.path({
        filters: ['directory'],
        allowCreate: true,
      })
        .default('data/fonts')
        .description('存放字体文件的目录路径'),

      fontTTL: Schema.number()
        .default(5)
        .min(1)
        .max(60)
        .description('字体在内存中的存活时间（分钟）<br>超过此时间未使用的字体将被自动释放')
    }).description('基础设置'),

    Schema.object({
      fontPreview: Schema.dynamic('glyph.fonts')
        .description(`开启插件后，将展示可用的字体列表<br>**此列表会自动监听字体目录的变化并实时更新**<br>> 用于预览所有可用字体，无实际功能`),
    }).description('可用字体'),
  ])

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
    const schemaWatcher = watch(ctx.glyph.fontNames, () => {
      ctx.glyph['updateSchema']();
    });

    // 在插件卸载时停止所有监听
    ctx.effect(() => {
      // 返回一个函数，该函数将执行所有清理操作
      return () => {
        schemaWatcher.stop();
        ctx.glyph.stop(); // 停止文件监听
      };
    });
  });

  // 注册前端页面和Provider
  ctx.inject(['console', 'glyph'], (ctx) => {
    // 注册前端入口
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    });

    // 注册Provider服务
    ctx.plugin(GlyphProvider, ctx.glyph);
  });
}
