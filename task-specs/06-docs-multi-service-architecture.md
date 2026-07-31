# 追加タスク書: 7アプリ構成の横断設計文書を更新する

## 背景

現在の `docs` はFront、BFF、家計簿API、既存Authの4アプリ構成だけを記載している。
Toolbox、Arcade Auth、Arcade API、およびBFFによる複数上流の呼び分けが反映されていない。

実装完了後の構成を設計の正本へ反映する。

## 実行順

`04-bff-multi-api-routing.md` と `05-service-test-isolation.md` の完了後に実行する。
未実装の予定を現在仕様として書かない。

## 作業対象

- `docs`

変更しない対象:

- 各アプリ
- 親ワークスペース

docsは独立Gitリポジトリであり、現在は `main` 運用である。commitとpushは実行しない。

## 更新する内容

### システム全体構成

`docs/docs/architecture/system-overview.md`:

- 7アプリと4種類のDB/Redis所有関係
- FrontはBFFだけをアプリケーションAPIとして呼ぶ
- BFFから3つのResource APIへのroute dispatch
- `matsu-auth` が `matsu-api` と `matsu-toolbox-api` を担当
- `matsu-arcade-auth` が `matsu-arcade-api` だけを担当
- APIごとのissuer/audience
- Backend API同士が直接呼び合わないこと
- DB/Redisをサービス間共有しないこと
- 1つの上流障害が他routeを停止させない方針

### 認証・セッション

`docs/docs/architecture/authentication.md`:

- BFF session内のresource別token slot
- 既存AuthのAuthorization Code + PKCE
- Toolbox用scope/audience
- Arcade AuthのJSON login/refreshをBFFが仲介する現在方式
- BrowserへJWT/refresh tokenを返さない
- resource別refresh失敗時の分離
- logout全体とresource disconnect
- Auth/JWKS/APIの信頼関係

Arcade OAuth/OIDCを実装していない場合、それを実装済みのように書かない。

### Components

既存 `docs/docs/components/` 構造の中へ追加する。

- `toolbox-api.md`
- `arcade-auth.md`
- `arcade-api.md`

既存も更新する。

- `bff.md`: 複数上流、複数token、Frontend向け契約
- `auth.md`: 複数resource対応
- `frontend.md`: BFFだけを呼ぶ
- `api.md`: 家計簿専用Resource Server

新しいトップレベルカテゴリは作らない。

### Docs README

- 対象リポジトリ一覧を7アプリへ更新
- 新component文書への索引
- 各サービスの1行責務

## 記述上の注意

- 実装済みと将来案を分ける。
- ローカルURLや起動コマンドの羅列は各repo READMEへ委ねる。
- Auth DBとdomain DBを共有しないことを明記する。
- BFFは汎用reverse proxyではなく、明示的なFrontend契約所有者として記載する。
- APIが直接到達可能でも、Browserの正式経路はBFFであることを区別する。
- Mermaid図と文章で同じ関係を表す。

## 検証

- 全Markdown linkが存在する。
- Mermaidのnode/edgeに7アプリが過不足なく登場する。
- issuer/audience対応が実装設定と一致する。
- FrontからBackend APIへの直接edgeがない。
- Backend API間の直接edgeがない。
- DB/Redisの所有者が一意。
- `rg` で旧「4アプリだけ」の一覧や「matsu-apiだけを呼ぶBFF」という説明が残っていない。

## 完了条件

- 実装後の7アプリ構成が設計の正本に反映される。
- Front → BFF → 各APIの境界が明確。
- 2つのAuth realmと3つのaudienceが明確。
- サービスとDBの疎結合が明記される。
- 新しいトップレベルカテゴリを追加していない。
- commitとpushを実行していない。

## 最終報告

- 更新文書一覧
- 追加した構成図
- 認証/route/データ所有境界
- link・用語・設定値の検証結果

