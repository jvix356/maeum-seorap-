# 마음 서랍 안드로이드 앱 준비 (TWA)

마음 서랍은 이미 PWA(설치형 웹앱)라서, 사이트를 그대로 감싸는 **TWA(Trusted Web Activity)** 방식으로 안드로이드 앱을 만들 수 있어요. 앱 안에서도 일기는 지금처럼 기기 브라우저 저장소에만 남고 서버로 가지 않아요.

## 이미 준비된 것
- `manifest.webmanifest`: 이름·아이콘·시작 주소·세로 화면·standalone
- 안드로이드 원형/물방울 모양 아이콘용 여백 아이콘: `icon-maskable-192.png`, `icon-maskable-512.png` (기존 아이콘을 줄여 안전 영역 안에 배치, 직접 만든 그림만 사용)
- `sw.js`: 오프라인 캐시
- 개인정보처리방침 페이지: https://maeum-seorap.vercel.app/privacy.html (Play Console 입력용)

## 연이 님이 직접 해야 하는 것 (계정·비밀값)
1. Google Play Console 개발자 계정 만들기(등록비 있음, 본인 확인 필요)
2. 앱 서명 키는 **Play 앱 서명**을 쓰기를 권장해요. 업로드 키(.keystore)와 비밀번호는 연이 님 컴퓨터나 안전한 곳에만 보관하고 채팅·저장소에 올리지 마세요.
3. 키를 만든 뒤 나오는 SHA-256 지문으로 `/.well-known/assetlinks.json`을 만들어 올려야 앱 상단에 주소창이 안 보여요(아래 양식).

## 앱 만들기 (Bubblewrap)
```
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://maeum-seorap.vercel.app/manifest.webmanifest
bubblewrap build
```
`init`에서 묻는 값 추천:
- 패키지 이름: `io.github.jvix356.maeumseorap` (한 번 정하면 못 바꿔요)
- 앱 이름: 마음 서랍 / 시작 주소: `/` / 화면: portrait
- 알림 위임(notification delegation): 쓰지 않음(현재 알림 기능 없음)

`build`가 끝나면 Play에 올릴 `app-release-bundle.aab`와 `assetlinks.json`에 넣을 지문이 나와요.

## assetlinks.json 양식
지문을 받은 뒤 `/.well-known/assetlinks.json`으로 올려 주세요(지문 없이 미리 올리면 안 돼요).
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "io.github.jvix356.maeumseorap",
    "sha256_cert_fingerprints": ["Play Console > 앱 무결성 > 앱 서명 키의 SHA-256"]
  }
}]
```

## Play Console 입력 시 확인할 점
- **데이터 보안 양식**: 일기·감정·첨부·비밀번호는 기기에만 저장, 수집 안 함. 나눔터 게시판에 직접 쓴 글과 방문 숫자 합계만 서버에 저장(개인정보처리방침과 똑같이 적기).
- **콘텐츠 등급·대상 연령**: 나눔터(이용자 게시판)가 있으니 "사용자 간 상호작용 있음"으로 표시하고, 신고 기능이 있다는 점을 적어요.
- **건강 관련 표현 주의**: 감정 기록 앱이지 상담·치료 앱이 아니라는 점을 설명에 분명히 적어요(의료 효과 주장 금지).
- **스토어 그림**: 직접 만든 아이콘·캐릭터만 쓰고, 다른 앱·캐릭터 그림은 넣지 않아요.
