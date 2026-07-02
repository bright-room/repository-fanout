# マージ挙動の例（既存ファイルがあるリポ）

`examples/*.renovate.json` / `*.gitignore` は**ファイルが無いリポへの新規作成**時の出力。
既にファイルがあるリポでは、fanout は**自分が管理する断片だけ**を触る。その before/after を示す。

## renovate.json（json-field: extends）

対象リポ: `profiles: ["java"]` → `["java", "typescript"]` に変更（フロントエンド追加）。
リポは独自キー（packageRules）と独自 extends エントリ（`:enablePreCommit`）を持っている。

**before（リポの現状）**
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>bright-room/renovate-config",
    ":enablePreCommit"
  ],
  "packageRules": [
    { "matchPackageNames": ["internal-lib"], "enabled": false }
  ],
  "ignorePaths": ["examples/**"]
}
```

**after（fanout の PR）**
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>bright-room/renovate-config",
    "github>bright-room/renovate-config:typescript",
    ":enablePreCommit"
  ],
  "packageRules": [
    { "matchPackageNames": ["internal-lib"], "enabled": false }
  ],
  "ignorePaths": ["examples/**"]
}
```

- 変わったのは extends に `:typescript` が入っただけ。
- `:enablePreCommit` は universe（base∪全 profile の貢献集合）外＝**リポ独自エントリなので温存**され、管理分の**後ろ**に置かれる（renovate は後勝ちマージ＝リポ優先）。
- `packageRules` / `ignorePaths` 等の他キーは**不可侵**。
- スタック転換（`["typescript"]` → `["kotlin"]`）なら `:typescript` が `:kotlin` に置き換わるだけ。

## .gitignore（managed-block）

対象リポ: `profiles: ["typescript"]`。リポは独自エントリを既に持っている。

**before**
```
node_modules/
coverage/
/generated
```

**after（fanout の PR）**
```
# >>> repository-fanout managed >>>
# OS / editor
.DS_Store
Thumbs.db
.idea/
.vscode/

# env
.env
.env.local
# node
node_modules/
dist/
*.tsbuildinfo
npm-debug.log*
pnpm-debug.log*
# <<< repository-fanout managed <<<
node_modules/
coverage/
/generated
```

- ブロックを**先頭に挿入**し、既存内容はそのまま下に温存（重複 `node_modules/` は gitignore 的に無害。掃除するかはリポの自由＝ブロック外は以後 fanout が触らない）。
- 以後の更新（profile 追加等）は**ブロック内だけ**が変わる。

## .github/CODEOWNERS（managed-block）

対象リポ: リポがパス別ルールを自分で追加していく。

**fanout が作る初期状態**
```
# >>> repository-fanout managed >>>
* @bright-room/br-maintainers
# <<< repository-fanout managed <<<
```

**リポが育てた後（fanout はこの状態を壊さない）**
```
# >>> repository-fanout managed >>>
* @bright-room/br-maintainers
# <<< repository-fanout managed <<<
/terraform/ @bright-room/br-owners
/docs/      @kukv
```

- CODEOWNERS は**後勝ち**。ブロックが先頭にあるため、下に書いたパス別ルールが常に既定行 `*` に勝つ＝fanout はリポの個別指定を上書きできない。
- `vars.codeowner` を変えると（例: チーム変更）、ブロック内の `*` 行だけ更新される。
