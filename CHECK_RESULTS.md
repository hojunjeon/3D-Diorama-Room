# 검증 결과

## PASS

2026-08-30 Windows 로컬 환경에서 다음 명령을 실행했습니다.

```powershell
node --check src/app.js
node --test tests/smoke_test.mjs
```

확인 항목:

- `index.html`과 `widget.html` 실제 Chrome 로드
- 공개 `PhysicalDiorama` API
- 가구 충돌 위치 이동 거부
- 소파 이동 후 `sitting` 상태 전환
- 스킨 3종 전용 상호작용 포즈 시트 로드 완료
- 박스 이불 제거·곡선 이불 렌더와 소파 전면 차단 제거 계약
- 침대 `lying`·책상 의자 `studying` 상태와 Canvas 오류 0건
- 달력 날짜 선택·메모 저장·닫기·재오픈 복원
- 예산 보드 5개 카테고리 금액·사용률 표시
- 행동 버튼의 활성·ARIA 상태
- 제스처 API와 UI 버튼
- 초기화 시 진행 중 제스처 해제
- 화면의 상태 백분율과 실제 progress 값 일치
- 방·캐릭터 스킨 변경
- `localStorage` 저장 후 새로고침 복원
- 실제 포인터 드래그를 통한 가구 겹침 거부
- 실제 포인터 드래그를 통한 접근 앵커 불가 배치 거부
- 캐릭터 위 가구 배치 거부
- 375px 화면의 가로 넘침 없음
- 기본 흐름과 미리보기 흐름의 데스크톱·모바일 런타임 예외 0건
- 데스크톱·모바일 미리보기 생성

## 시각 확인

- `preview-desktop-v2.png`: 데스크톱 장면 중심 UI
- `preview-mobile-v2.png`: 모바일 소파 착석 상태
- `demo-interactions-and-room-tools.mp4`: 29.7초, 1080×1920, H.264, 30fps 전용 포즈·달력·예산 모달 최종 데모
- 생성형 창밖 풍경 로드 확인

## 경계

- 실제 3D 강체·관절 물리는 범위 밖입니다.
- 별도 LLM·백엔드·네이티브 WebView 메시지 브리지는 포함하지 않습니다.
