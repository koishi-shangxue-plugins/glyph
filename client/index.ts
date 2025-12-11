import { Context, icons } from '@koishijs/client'

import icom from './icon/icon.vue'
import layout from './layout.vue'
icons.register('glyph', icom)

export default (ctx: Context) => {
  ctx.page({
    name: '字体管理',
    path: '/glyph',
    icon: 'glyph',
    component: layout,
    fields: ['glyph'],
  })
}
