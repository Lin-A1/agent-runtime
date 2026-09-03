---
name: review-pr
description: 审查指定 PR 或当前分支的 PR（读取 diff 与评论并逐条建议）
---

请使用 gh CLI 查看当前 PR 的状态、diff 与未解决的评论（gh pr view --comments 2>&1 || git diff origin/main...HEAD），逐条梳理评审意见并给出针对性的修改建议或直接修复代码。参数：$ARGUMENTS
