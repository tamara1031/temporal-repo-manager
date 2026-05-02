# Deployment Example (Reference Only)

> 実運用の Deployment / Secret / NetworkPolicy はこのリポジトリの homelab 側で
> 一括管理されます。ここに置く YAML はあくまでサンプルで、homelab 側の構成に
> 取り込む際の参照用です。

## 前提

- Worker はアウトバウンド通信のみ。Service / Ingress / HTTPRoute は不要です。
- 必要な認証情報:
  - `GITHUB_TOKEN` … GitHub PAT（環境変数）
  - `~/.codex/auth.json` … codex CLI のブラウザログイン後に生成される認証ファイル
    （ローカルで `codex login` を 1 度走らせて生成してから Secret 化）

## 環境変数

`agent-platform-config` ConfigMap 相当に渡したい値:

| Key | 既定値 | 用途 |
| --- | --- | --- |
| `TEMPORAL_ADDRESS` | `temporal-frontend.temporal.svc.cluster.local:7233` | Temporal Frontend |
| `TEMPORAL_NAMESPACE` | `default` | 名前空間 |
| `TEMPORAL_TASK_QUEUE` | `agent-platform` | Worker のタスクキュー |
| `TEMPORAL_MAX_CONCURRENT_ACTIVITIES` | `4` | アクティビティ並列度 |
| `TEMPORAL_MAX_CONCURRENT_WORKFLOWS` | `20` | ワークフロータスク並列度 |
| `TEMPORAL_TLS` | `false` | mTLS 利用時に `true` |

## サンプル: Deployment + Secret マウント

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-platform-worker
  namespace: agent-platform
spec:
  # workdir はローカル emptyDir に置くため、PR ライフサイクル子ワークフローを
  # またいで同一 Pod 上で完結する必要があります。スケールするなら
  # 「issue/refactor 単位で完結する別 Worker プール」へ分割するか、
  # workdir を共有ボリュームに置く設計に変更してください。
  replicas: 1
  selector:
    matchLabels:
      app: agent-platform-worker
  template:
    metadata:
      labels:
        app: agent-platform-worker
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001
      containers:
        - name: worker
          image: ghcr.io/<owner>/agent-platform:latest
          envFrom:
            - configMapRef:
                name: agent-platform-config
          env:
            - name: GITHUB_TOKEN
              valueFrom:
                secretKeyRef:
                  name: github-token
                  key: token
            - name: HOME
              value: /home/agent
          volumeMounts:
            - name: codex-auth
              mountPath: /home/agent/.codex
              readOnly: true
            - name: workspaces
              mountPath: /workspaces
          resources:
            requests: { cpu: "500m", memory: "1Gi" }
            limits:   { cpu: "2",    memory: "4Gi" }
      volumes:
        - name: codex-auth
          secret:
            secretName: codex-auth
            items:
              - key: auth.json
                path: auth.json
            defaultMode: 0400
        - name: workspaces
          emptyDir:
            sizeLimit: 10Gi
```

## サンプル: Secret 投入コマンド

事前にローカルで `codex login`（ブラウザフロー）を実行し、`~/.codex/auth.json` を生成しておきます。

```bash
kubectl -n agent-platform create secret generic github-token \
  --from-literal=token="$GITHUB_TOKEN"

kubectl -n agent-platform create secret generic codex-auth \
  --from-file=auth.json="$HOME/.codex/auth.json"
```

> auth.json はリフレッシュトークンを含みます。ローテーションは
> `codex login` をやり直して Secret を再投入する形になります。

## サンプル: NetworkPolicy（アウトバウンド限定）

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: agent-platform-outbound-only
  namespace: agent-platform
spec:
  podSelector:
    matchLabels:
      app: agent-platform-worker
  policyTypes: [Ingress, Egress]
  ingress: []
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: temporal
      ports:
        - { protocol: TCP, port: 7233 }
    - ports:
        - { protocol: TCP, port: 53 }
        - { protocol: UDP, port: 53 }
    - to: []
      ports:
        - { protocol: TCP, port: 443 }
```

## Schedule の登録

`scripts/schedule-setup.sh` を Worker Pod もしくは管理者端末で実行してください。
`temporal` CLI が解決できる Cluster へ向けて
`periodicRefactorWorkflow` の Schedule を upsert します。

```bash
TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233 \
TEMPORAL_NAMESPACE=default \
AGENT_REPO=<owner>/<repo> \
AGENT_BASE_BRANCH=main \
./scripts/schedule-setup.sh
```
