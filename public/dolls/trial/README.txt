시험용 돌(구매·무료 모델 비교용). 이 폴더의 파일은 git에 올라가지 않습니다.

1) 모델 파일(GLB 또는 FBX)을 이 폴더에 넣는다.
2) manifest.json 에 항목을 적는다. 예:
[
  { "id": "trial_mixamo_m", "name": "시험 남(믹사모)", "gender": "male", "baseHeightCm": 175, "file": "mixamo_male.fbx" }
]
3) 앱을 다시 불러오면(F5 또는 다시 실행) 돌 탭에 '시험' 돌이 나타난다.
뼈 이름이 믹사모(mixamorig:Hips …)와 다르면 항목에 "boneMap": { "원래 이름": "표준 이름" } 을 넣는다.
