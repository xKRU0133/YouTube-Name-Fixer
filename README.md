### 概要
YouTubeライブチャット、コメント欄に表示される **@ハンドル名** を、視認性の高い **チャンネル表示名** に自動で置き換える拡張機能です。

### 規約遵守について
- YouTube API を使用しない  
- 公開済みの DOM 情報のみを読み取り、非公開データへアクセスしない  
- サーバー側データを改変せず、ローカル表示のみ変更  
- 外部へのデータ送信・収集を一切行わない  
- 他ユーザーの体験を変更しない  

したがって、**ユーザーの閲覧環境のカスタマイズの範囲内であり利用規約に違反していないと認識しています。**

### 主な機能
- ハンドル名 → チャンネル表示名へ自動変換  
- 新規チャット・過去ログの両方に対応   
- YouTube API 不使用  
- プライバシー保護：外部送信なし

### 動作方法
`<yt-live-chat-item-list-renderer>` `<ytd-comments#comments>`を監視し、その内部の公開情報から表示名を抽出して置換します。YouTubeの内部機能には干渉しません。

### インストール
・https://chromewebstore.google.com/detail/youtube-handle-to-channel/deljipnkklbhjjoofpjgjmncpmomkndf?authuser=0&hl=ja

### 注意点
- YouTube側のDOM構造が変わると動作しなくなる可能性があります。  
- 外部サービスへの影響や迷惑行為には使用できません。

### ライセンス
MIT License

---

## English Description

### Overview
This extension automatically replaces YouTube Live Chat and comments **handle names (@username)** with their **channel display names** for improved readability.  

### Compliance Statement
This extension **does NOT violate YouTube’s Terms of Service, API policies, or the Chrome Extension Program policies** because:
- It does not use or interact with the YouTube API  
- It accesses only publicly available DOM data  
- It does not modify server-side data or affect other users  
- It performs no data collection or external data transmission  
- All modifications occur only within the user's local browser  

Therefore, it is **a safe and permitted form of client-side UI customization**.

### Features
- Converts handle names to channel display names  
- Works on both new messages and chat replay   
- No API usage  
- Privacy-safe: no external communication

### How It Works
The extension observes `<yt-live-chat-item-list-renderer>` `<ytd-comments#comments>` elements and extracts display names from their public internal data.  red, ensuring full compliance with platform policies.

### Installation
・https://chromewebstore.google.com/detail/youtube-handle-to-channel/deljipnkklbhjjoofpjgjmncpmomkndf?authuser=0&hl=ja

### Notes
- May require updates if YouTube changes its internal structure  
- Do not use this tool in ways that disrupt YouTube or bypass platform restrictions  

### License
MIT License
