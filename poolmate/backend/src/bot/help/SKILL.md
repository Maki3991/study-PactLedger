# PoolMate Bot Command Skill

This Markdown file is the single help skill source for PoolMate bot commands.
The bot loads this file for `/help`, `/pool_help <request>`, local keyword
matching, and LLM command skill calling.

## Command Skill Calling Rules

- Choose exactly one Command Skill ID to call for the user's PoolMate request.
- Return `unknown` when the request is unrelated or too ambiguous.
- Do not execute commands, create orders, create checkouts, create payments,
  infer payees, or invent order IDs.
- Debug commands are allowed in help output, but they only change local demo
  claims and must not be presented as payment, checkout, receipt, or chain
  operations.
- Return compact JSON only: `skillId`, `confidence`, and optional `reason`.

<!-- prettier-ignore-start -->

## Command Skill: start_bot

Title: Start PoolMate
User request: The user wants to initialize a private chat with the bot.
Command: /start
Description: Opens the PoolMate private chat and confirms the bot is ready for the user.
Examples:
- /start
Keywords: start, hello, init, begin, 开始, 启动, 初始化, 私聊
Debug: false

## Command Skill: bot_status

Title: Check bot status
User request: The user wants to see bot or LLM runtime status.
Command: /status
Description: Shows whether the Telegram bot is running and whether natural-language draft parsing is configured.
Examples:
- /status
Keywords: status, health, running, llm, 状态, 健康, 运行, 模型
Debug: false

## Command Skill: general_help

Title: Show help
User request: The user wants a command list or wants PoolMate to suggest a command from natural language.
Command: /help or /pool_help <what you want to do>
Description: Lists PoolMate commands. With a request after /pool_help, PoolMate calls the closest command skill through LLM command skill calling first and keyword matching as fallback.
Examples:
- /help
- /pool_help 我想锁单报价
Keywords: help, commands, manual, usage, 帮助, 指令, 命令, 怎么用
Debug: false

## Command Skill: create_pool

Title: Create a pool
User request: The user wants to create a new group purchase.
Command: @PoolMate 我们要拼单，期望3瓶可乐，美团外卖 xx店铺名 or /pool_new <expectedUnits> <title>
Description: Starts a PoolMate order. Natural language opens a processing card first, then updates the same card into a claimable pool after parsing.
Examples:
- @PoolMate 我们要拼单，期望3瓶可乐，美团外卖 xx店铺名
- /pool_new 3 Cola
Keywords: create, start, new, pool, order, 发起, 创建, 拼单, 开团, 下单
Debug: false

## Command Skill: claim_units

Title: Claim units
User request: The user wants to join a pool or change their claimed quantity.
Command: /pool_claim <orderId> [units]
Description: Claims units for the current Telegram user while the pool is still collecting.
Examples:
- /pool_claim order-1
- /pool_claim order-1 2
Keywords: claim, join, take, units, participate, 认领, 加入, 我要, 参加, 买
Debug: false

## Command Skill: leave_pool

Title: Leave a pool
User request: The user wants to leave a pool or remove their claim.
Command: /pool_leave <orderId>
Description: Removes the current Telegram user's claim before checkout confirmation begins.
Examples:
- /pool_leave order-1
Keywords: leave, exit, remove me, cancel claim, 退出, 不买, 取消认领, 撤销
Debug: false

## Command Skill: request_quote

Title: Request final quote
User request: The owner wants to lock the current participants and request checkout.
Command: /pool_quote <orderId>
Description: Locks the current claimed units, even below or above the expected quantity, and requests the verified Checkout.
Examples:
- /pool_quote order-1
Keywords: quote, checkout, lock, final, pay, 报价, 锁单, 结账, 付款, 结算
Debug: false

## Command Skill: check_status

Title: Check order status
User request: The user wants to inspect order, checkout, confirmation, payment, or receipt status.
Command: /pool_status <orderId>
Description: Shows the current order, checkout, confirmation, payment, and receipt state.
Examples:
- /pool_status order-1
Keywords: status, progress, receipt, order, checkout, 状态, 进度, 凭证, 订单
Debug: false

## Command Skill: close_pool

Title: Close pool
User request: The owner wants to close the pool before payment submission.
Command: /pool_close <orderId>
Description: Closes a safe pre-submission order and records cancellation evidence without creating a receipt.
Examples:
- /pool_close order-1
Keywords: close, cancel, stop, terminate, 关闭, 取消, 终止, 停止
Debug: false

## Command Skill: remind_confirmations

Title: Remind confirmations
User request: The owner wants to resend pending confirmation links.
Command: /pool_remind <orderId>
Description: Rotates pending confirmation links and privately sends fresh Telegram WebApp links.
Examples:
- /pool_remind order-1
Keywords: remind, resend, confirm, link, 提醒, 重发, 确认, 链接
Debug: false

## Command Skill: debug_virtual_participants

Title: Adjust virtual participants
User request: The tester wants to manually add or remove virtual participants for a demo.
Command: /pool_test <orderId> +N or /pool_test <orderId> -N
Description: Debug command. Adds or removes deterministic Virtual #001-style participants for manual Telegram testing. It only changes claims and never creates checkout, confirmation, payment, receipt, or chain evidence by itself.
Examples:
- /pool_test order-1 +2
- /pool_test order-1 -1
- /pool_test order-1 add 3
- /pool_test order-1 remove 1
Keywords: test, debug, virtual, fake, demo, add people, remove people, 测试, 调试, 虚拟, 假人, 加人, 减人
Debug: true

<!-- prettier-ignore-end -->
