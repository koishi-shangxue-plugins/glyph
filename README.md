# koishi-plugin-glyph

[![npm](https://img.shields.io/npm/v/koishi-plugin-glyph?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-glyph)

Koishi 的字体管理器插件

## 安装

在 Koishi 插件市场中搜索 `glyph` 安装。

## 配置

在 Koishi 中启用插件后，将字体文件放入 `data/fonts` 目录（默认路径）。

插件会自动创建该目录，无需手动创建。

**注意**：`root` 配置项是相对于 Koishi 实例的根目录（`ctx.baseDir`）。

例如，如果你的 Koishi 安装在 `/home/user/koishi`，那么字体目录应该是 `/home/user/koishi/data/fonts`。

## 完整使用示例

参考 [`example-usage.ts`](./example-usage.ts) 文件查看完整的使用示例。

## API

参考 [`README API`](./README%20API.md) 文件查看完整的说明。

## 动态配置项说明

### 什么是动态配置项？

动态配置项 (`Schema.dynamic`) 是 Koishi 提供的一种机制，允许一个插件动态地为其他插件提供配置选项。

> <https://koishi.chat/zh-CN/schema/advanced/dynamic.html>

### 使用限制

- 动态配置项在开发模式 (`yarn dev`) 下不显示选项列表
- 需要在生产模式 (`yarn start`) 下才能看到完整的字体选择列表

## 常见问题

### Q: 为什么在开发模式下看不到字体选项？

A: 这是 Koishi 动态配置项的预期行为。请在生产模式 (`yarn start`) 下查看。

### Q: 如何添加新字体？

A: 将字体文件放入 `data/fonts` 目录，然后重启 Koishi。

### Q: 支持哪些字体格式？

A: 支持 TTF、OTF、WOFF、WOFF2、TTC、EOT、SVG 等常见字体格式。

### Q: 字体文件很大，会影响性能吗？

A: 字体在启动时加载一次并缓存为 Base64，不会重复加载。但建议使用压缩过的字体文件。

## 许可证

MIT License

## 相关链接

- [GitHub 仓库](https://github.com/koishi-shangxue-plugins/koishi-plugin-glyph)
- [问题反馈](https://github.com/koishi-shangxue-plugins/koishi-plugin-glyph/issues)
- [Koishi 官网](https://koishi.chat)
