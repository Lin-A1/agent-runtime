---
name: clean-gone
description: 清理本地已在远端合并或删除的 git 分支
---

请检查当前仓库的本地与远端分支（git fetch -p && git branch -vv），找出标记为 : gone] 的陈旧本地分支，并安全清理（跳过当前分支与主分支）。
