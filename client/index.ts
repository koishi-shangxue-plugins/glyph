import { defineComponent, h, resolveComponent } from 'vue'
import { Context, icons } from '@koishijs/client'
import icom from './icon/icon.vue'
import layout from './layout.vue'

// 注册图标
icons.register('glyph', icom)

export default (ctx: Context) => {
  ctx.page({
    name: '字体管理',
    path: '/glyph',
    icon: 'glyph',
    component: defineComponent({
      setup() {
        return () => h(resolveComponent('k-layout'), {}, {
          default: () => h(layout)
        })
      },
    }),
    fields: ['glyph' as any],
  })
}
