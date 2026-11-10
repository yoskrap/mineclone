#!/usr/bin/env bash
# 원본 마인크래프트 녹화본과 MineClone 데모를 좌우로 붙여 제출용 영상을 만든다.
# 사용법: ./make_side_by_side.sh 원본녹화.mp4 mineclone_demo.mp4 결과.mp4
# 필요: ffmpeg (Windows는 https://www.gyan.dev/ffmpeg/builds/ 에서 받아 PATH에 추가)
#
# - 소리는 MineClone 쪽 나레이션을 사용합니다(원본 녹화 소리는 끔).
# - 두 영상 길이가 다르면 짧은 쪽의 마지막 화면이 멈춘 채 유지됩니다.
# - 원본은 촬영_순서표.md 의 시간표에 맞춰 같은 순서로 녹화하면 장면이 나란히 맞습니다.
set -e
ORIG="${1:?원본 녹화 파일}"
CLONE="${2:?mineclone_demo.mp4}"
OUT="${3:-side_by_side.mp4}"
# 한글 폰트 (Windows 기본: 맑은 고딕). 다른 OS면 FONT=/경로/폰트.ttf ./make_side_by_side.sh ... 로 지정
FONT="${FONT:-C\\:/Windows/Fonts/malgunbd.ttf}"

ffmpeg -y -i "$ORIG" -i "$CLONE" -filter_complex "\
[0:v]scale=956:538:force_original_aspect_ratio=decrease,pad=956:538:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=25,tpad=stop_mode=clone:stop_duration=600[l];\
[1:v]scale=956:538,setsar=1,fps=25,tpad=stop_mode=clone:stop_duration=600[r];\
color=c=0x1F2124:s=1920x1080:r=25[bg];\
[bg][l]overlay=2:271:shortest=0[t1];[t1][r]overlay=962:271:shortest=0[t2];\
[t2]drawbox=x=2:y=200:w=956:h=60:color=0x4E8A2C@1:t=fill,drawbox=x=962:y=200:w=956:h=60:color=0x8A5A36@1:t=fill,\
drawtext=fontfile='$FONT':text='원본 · Minecraft Java Edition':fontcolor=white:fontsize=30:x=2+(956-tw)/2:y=213,\
drawtext=fontfile='$FONT':text='MineClone · 웹 클론 (AI 역분석)':fontcolor=white:fontsize=30:x=962+(956-tw)/2:y=213,\
drawtext=fontfile='$FONT':text='Minecraft Java Edition vs MineClone 기능 비교 데모':fontcolor=0xC9D3C0:fontsize=34:x=(w-tw)/2:y=110[v]" \
  -map "[v]" -map 1:a -shortest -c:v libx264 -crf 20 -preset veryfast -c:a aac -b:a 160k "$OUT"

echo "완료: $OUT"

