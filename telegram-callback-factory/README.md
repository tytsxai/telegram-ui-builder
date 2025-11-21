# telegram-callback-factory

🤖 自动生成、解析和管理 Telegram Bot 的 `callback_data`

## 特性

✅ **自动生成** - 带命名空间、action、参数、TTL、防重放  
✅ **智能解析** - 带校验、过期检查、防重复点击  
✅ **路由系统** - 统一 Router / Middleware，方便注册回调  
✅ **长度控制** - 自动裁剪参数，确保 ≤ 64 字节  
✅ **零依赖** - 内置轻量 MemoryCache，无外部依赖  
✅ **TypeScript** - 完整类型定义

## 安装

```bash
npm install telegram-callback-factory
```

## 快速开始

### 基础使用

```typescript
import createCallbackManager from 'telegram-callback-factory';

const cbx = createCallbackManager();

// 生成 callback_data
const callback = cbx.make('menu', 'open', { tab: 'wallet' });
// => "menu:open:eyJ0YWIiOiJ3YWxsZXQifQ::abc123"

// 解析 callback_data
const parsed = cbx.parse(callback);
console.log(parsed);
// {
//   ns: 'menu',
//   action: 'open',
//   data: { tab: 'wallet' },
//   nonce: 'abc123',
//   expired: false,
//   duplicate: false
// }
```

### 与 Telegraf 集成

```typescript
import { Telegraf } from 'telegraf';
import createCallbackManager from 'telegram-callback-factory';

const bot = new Telegraf(process.env.BOT_TOKEN!);
const cbx = createCallbackManager({ ttl: 600000 }); // 10分钟过期

// 注册路由
cbx.router.on('menu', 'open', async (parsed, ctx) => {
  const { tab } = parsed.data || {};
  await ctx.reply(`打开菜单: ${tab}`);
});

cbx.router.on('confirm', 'delete', async (parsed, ctx) => {
  const { id } = parsed.data || {};
  await ctx.reply(`确认删除 ID: ${id}`);
  // 执行删除逻辑...
});

// 使用中间件 + 路由调度
bot.action(/.+/, cbx.parser.middleware(), async (ctx) => {
  const parsed = (ctx as any).parsedCallback;
  if (parsed) {
    const handled = await cbx.router.dispatch(parsed, ctx);
    if (!handled) {
      await ctx.answerCallbackQuery('未知操作');
    }
  }
});

// 发送带回调按钮的消息
bot.command('menu', (ctx) => {
  ctx.reply('选择功能:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 钱包', callback_data: cbx.make('menu', 'open', { tab: 'wallet' }) }],
        [{ text: '⚙️ 设置', callback_data: cbx.make('menu', 'open', { tab: 'settings' }) }],
        [{ text: '🗑️ 删除', callback_data: cbx.confirm('delete', { id: 123 }) }],
      ],
    },
  });
});

bot.launch();
```

### 与 grammY 集成

```typescript
import { Bot } from 'grammy';
import createCallbackManager from 'telegram-callback-factory';

const bot = new Bot(process.env.BOT_TOKEN!);
const cbx = createCallbackManager();

// 注册路由
cbx.router.on('page', 'nav', async (parsed, ctx) => {
  const { page } = parsed.data || {};
  await ctx.editMessageText(`第 ${page} 页内容...`);
});

// 中间件
bot.on('callback_query:data', async (ctx, next) => {
  const parsed = cbx.parse(ctx.callbackQuery.data);
  
  if (parsed.expired) {
    await ctx.answerCallbackQuery({ text: '操作已过期', show_alert: true });
    return;
  }
  
  if (parsed.duplicate) {
    await ctx.answerCallbackQuery('请勿重复点击');
    return;
  }
  
  (ctx as any).parsedCallback = parsed;
  await next();
});

// 调度
bot.on('callback_query:data', async (ctx) => {
  const parsed = (ctx as any).parsedCallback;
  await cbx.router.dispatch(parsed, ctx);
  await ctx.answerCallbackQuery();
});

// 分页示例
bot.command('list', (ctx) => {
  ctx.reply('列表:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '◀️', callback_data: cbx.page(1) },
          { text: '1/10', callback_data: 'noop' },
          { text: '▶️', callback_data: cbx.page(2) },
        ],
      ],
    },
  });
});

bot.start();
```

## API 文档

### `createCallbackManager(options?)`

创建回调管理器实例

**选项：**
- `ttl?` - 默认过期时间（毫秒），默认 300000 (5分钟)
- `maxLength?` - 最大长度限制，默认 64

**返回：** 包含以下方法的对象

### `make(namespace, action, data?, options?)`

生成 callback_data 字符串

```typescript
cbx.make('menu', 'open', { tab: 'wallet' }, { ttl: 600000, nonce: true });
```

**参数：**
- `namespace` - 命名空间，用于分类
- `action` - 动作名称
- `data?` - 附加数据对象
- `options?`
  - `ttl?` - 过期时间（毫秒）
  - `nonce?` - 是否添加防重放标识，默认 true

### `parse(callbackData)`

解析 callback_data 字符串

```typescript
const parsed = cbx.parse('menu:open:eyJ0YWIiOiJ3YWxsZXQifQ::abc123');
```

**返回：** `ParsedCallback` 对象
- `ns` - 命名空间
- `action` - 动作
- `data?` - 解析的数据
- `exp?` - 过期时间戳
- `nonce?` - 防重放标识
- `expired` - 是否过期
- `duplicate` - 是否重复点击
- `raw` - 原始字符串

### `router.on(namespace, action, handler)`

注册回调路由

```typescript
cbx.router.on('menu', 'open', async (parsed, ctx) => {
  // 处理逻辑
});
```

### `router.dispatch(parsed, ctx?)`

调度执行匹配的路由

```typescript
const handled = await cbx.router.dispatch(parsed, ctx);
```

### `middleware()`

获取中间件函数（自动解析 + 校验）

```typescript
bot.action(/.+/, cbx.middleware(), async (ctx) => {
  const parsed = ctx.parsedCallback;
});
```

### 便捷方法

#### `confirm(action, data?)`

生成确认操作的 callback

```typescript
cbx.confirm('delete', { id: 123 });
// => "confirm:delete:eyJpZCI6MTIzfQ::xyz789"
```

#### `page(page, data?)`

生成分页导航的 callback

```typescript
cbx.page(2, { filter: 'active' });
// => "page:nav:eyJwYWdlIjoyLCJmaWx0ZXIiOiJhY3RpdmUifQ::xyz789"
```

#### `open(target, data?)`

生成打开页面的 callback

```typescript
cbx.open('settings', { section: 'privacy' });
// => "nav:open:eyJ0YXJnZXQiOiJzZXR0aW5ncyIsInNlY3Rpb24iOiJwcml2YWN5In0::xyz789"
```

## 长度控制策略

当生成的 callback_data 超过 64 字节时，会自动按以下顺序裁剪：

1. 移除 `nonce`（防重放标识）
2. 移除 `exp`（过期时间）
3. 简化 `data`（只保留 id/page/action/type 字段）
4. 移除所有 `data`
5. 强制截断到 64 字节

## 示例场景

### 确认对话框

```typescript
bot.command('delete', (ctx) => {
  ctx.reply('确定要删除吗？', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ 确认', callback_data: cbx.confirm('delete_ok', { id: 456 }) },
          { text: '❌ 取消', callback_data: cbx.confirm('delete_cancel') },
        ],
      ],
    },
  });
});

cbx.router.on('confirm', 'delete_ok', async (parsed, ctx) => {
  const { id } = parsed.data || {};
  await ctx.reply(`已删除项目 ${id}`);
});
```

### 分页列表

```typescript
function renderPage(page: number) {
  return {
    text: `第 ${page} 页的内容...`,
    reply_markup: {
      inline_keyboard: [
        [
          page > 1 && { text: '⬅️ 上一页', callback_data: cbx.page(page - 1) },
          { text: `${page}/10`, callback_data: 'noop' },
          page < 10 && { text: '下一页 ➡️', callback_data: cbx.page(page + 1) },
        ].filter(Boolean),
      ],
    },
  };
}

cbx.router.on('page', 'nav', async (parsed, ctx) => {
  const { page } = parsed.data || { page: 1 };
  await ctx.editMessageText(renderPage(page).text, renderPage(page));
});
```

## License

MIT
