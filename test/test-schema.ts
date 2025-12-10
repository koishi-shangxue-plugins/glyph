/**
 * 最小的动态 Schema 测试 demo
 * 用于验证 ctx.schema.set() 和 Schema.dynamic() 的正确用法
 */

import { Context, Schema, Service } from 'koishi';

export const name = 'test-dynamic';

// 测试服务
class TestService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'test-dynamic', true);
  }

  async start() {
    // 方式1: 直接设置字符串数组
    this.ctx.schema.set('test.choices1', Schema.union(['foo', 'bar', 'baz']));

    // 方式2: 使用 Schema.const 数组
    this.ctx.schema.set('test.choices2', Schema.union([
      Schema.const('option1').description('选项1'),
      Schema.const('option2').description('选项2'),
      Schema.const('option3').description('选项3'),
    ]));

    this.ctx.logger.info('动态 Schema 已注册');
  }
}

export interface Config {
  choice1: string;
  choice2: string;
}

export const Config: Schema<Config> = Schema.object({
  choice1: Schema.dynamic('test.choices1').description('测试选择1 (字符串数组)'),
  choice2: Schema.dynamic('test.choices2').description('测试选择2 (Schema.const 数组)'),
});

export function apply(ctx: Context, config: Config) {
  // 注册测试服务
  ctx.plugin(TestService);

  ctx.logger.info('选择的值:', config.choice1, config.choice2);
}
