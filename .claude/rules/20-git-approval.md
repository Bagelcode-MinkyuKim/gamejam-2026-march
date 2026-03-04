# Git 명령어 사용 규칙

## 목적
Director와의 신뢰 기반 협업을 위해, git 명령어는 위험도에 따라 차등 적용한다.

## Tier 1: 자동 허용 (읽기 전용 명령어)

다음 명령어는 시스템 상태를 변경하지 않으므로 **승인 없이 자유롭게 사용 가능**:

- `git status` - 현재 작업 트리 상태 확인
- `git log` - 커밋 히스토리 조회
- `git diff` - 변경사항 비교
- `git show` - 커밋 상세 정보 조회
- `git branch` - 브랜치 목록 조회 (생성/삭제 제외)
- `git remote` - 원격 저장소 정보 조회

**원칙**: 읽기 전용 명령어는 자율적으로 사용하되, 효율성을 위해 필요한 만큼만 실행하라.

## Tier 2: 승인 필요 (변경 명령어)

다음 명령어는 저장소를 변경하므로 **반드시 AskUserQuestion으로 Director 승인 필요**:

- `git add` - 스테이징 영역에 파일 추가
- `git commit` - 커밋 생성
- `git push` - 원격 저장소에 푸시
- `git pull` - 원격 저장소에서 풀
- `git merge` - 브랜치 병합
- `git checkout` - 브랜치 전환 (파일 변경 가능)
- `git branch -d/-D` - 브랜치 삭제

**절차**:
1. Director가 "커밋", "푸시" 등의 명령을 내림
2. Mr. Baker가 필요한 git 명령어를 AskUserQuestion으로 제시
3. Director 승인 후 실행

**예외**: Director가 이미 명시적으로 명령한 경우 (예: "커밋해")는 해당 작업에 필요한 모든 git 명령어(status, diff, add, commit)를 묵시적으로 승인한 것으로 간주.

## Tier 3: 절대 금지 (파괴적 명령어)

다음 명령어는 **Director가 명시적으로 요청하지 않는 한 절대 실행 금지**:

- `git push --force` / `git push -f` - 강제 푸시 (원격 히스토리 덮어쓰기)
- `git reset --hard` - 작업 내용 완전 삭제
- `git clean -fd` - 추적되지 않는 파일 삭제
- `git rebase -i` - 대화형 리베이스 (히스토리 재작성)
- `git filter-branch` - 대량 히스토리 재작성
- `git reflog expire` - reflog 삭제

**원칙**: 이러한 명령어는 복구 불가능한 데이터 손실을 초래할 수 있으므로, Director가 "git reset --hard 해줘"처럼 정확한 명령어를 명시하지 않는 한 제안하지도, 실행하지도 않는다.

## 위반 시 조치

Mr. Baker가 이 규칙을 위반했을 경우:
1. 즉시 작업 중단
2. Director에게 위반 사실 보고
3. 복구 방법 제안 (가능한 경우)

## 철학

이 규칙은 **기술적 강제가 아닌 신뢰 기반 협약**이다. Mr. Baker는 규칙의 의도를 이해하고 자율적으로 준수하며, 불명확한 상황에서는 항상 질문한다.
