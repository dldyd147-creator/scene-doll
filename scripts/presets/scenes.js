// 기본 씬 팩 정의(개발 페이지에서 sceneRunner.js로 돌려 씬 JSON·썸네일을 뽑는다).
// 좌표: 원점=바닥, 앞(돌 정면)=+z, 오른쪽(화면 오른쪽, 정면 돌의 왼쪽)=+x. 길이 m.
// 돌: pose(포즈 id) g('m'=남 175cm·'f'=여 162cm) at([x,z]) face(도, 0=+z를 봄, 90=+x를 봄, -90=-x를 봄)
// 소품: id at([x,z]) face, 손에 쥐는 것은 hold:{doll(번호), hand}
// 카메라: pos([x,y,z]) look([x,y,z]) mm(초점거리)
export const SCENES = [];
const add = (id, name, tags, def) => SCENES.push({ id, name, tags, ...def });

// ---------- 2인 ----------
add('sc2_talk_face', '마주 보고 대화', ['대화'], {
  dolls: [
    { pose: 'stand_relaxed', g: 'm', at: [-0.6, 0], face: 90 },
    { pose: 'stand_armscrossed', g: 'f', at: [0.6, 0], face: -90 },
  ],
  cam: { pos: [0.4, 1.5, 3.8], look: [0, 1.05, 0], mm: 50 },
});
add('sc2_walk_side', '나란히 걷기', ['이동', '일상'], {
  dolls: [
    { pose: 'walk_a', g: 'm', at: [0.4, -0.35], face: 90 },
    { pose: 'walk_b', g: 'f', at: [-0.4, 0.35], face: 90 },
  ],
  cam: { pos: [-0.4, 1.4, 4.4], look: [0, 1.0, 0], mm: 50 },
});
add('sc2_standoff', '대치', ['대치', '전투'], {
  dolls: [
    { pose: 'fight_guard', g: 'm', at: [-0.8, 0], face: 90 },
    { pose: 'fight_guard', g: 'm', at: [0.8, 0], face: -90 },
  ],
  cam: { pos: [0.3, 1.3, 4.2], look: [0, 1.0, 0], mm: 50 },
});
add('sc2_lean_door', '문 옆에 기댄 사람과 마주 선 사람', ['대화', '일상'], {
  dolls: [
    { pose: 'stand_relaxed', g: 'm', at: [-0.55, 0], face: 70 },
    { pose: 'stand_lean_wall', g: 'f', at: [0.55, -0.05], face: -90 },
  ],
  props: [{ id: 'door', at: [0.85, -0.05], face: -90 }],
  cam: { pos: [0.3, 1.5, 4.0], look: [0.3, 1.0, 0], mm: 50 },
});
add('sc2_hug', '포옹', ['로맨스', '리액션'], {
  dolls: [
    { pose: 'emo_hug_ready', g: 'm', at: [-0.3, 0], face: 90 },
    { pose: 'emo_hug_ready', g: 'f', at: [0.3, 0], face: -90 },
  ],
  cam: { pos: [0.3, 1.4, 3.2], look: [0, 1.05, 0], mm: 50 },
});
add('sc2_hold_hands', '손잡기', ['로맨스', '일상'], {
  dolls: [
    { pose: 'stand_relaxed', g: 'm', at: [-0.33, 0], face: 0 },
    { pose: 'stand_relaxed', g: 'f', at: [0.33, 0], face: 0 },
  ],
  meet: [0, 'LeftHand', 1, 'RightHand'],
  cam: { pos: [0.2, 1.3, 3.6], look: [0, 1.0, 0], mm: 50 },
});
add('sc2_follow', '뒤에서 따라오기', ['이동'], {
  dolls: [
    { pose: 'walk_a', g: 'f', at: [0, 0.2], face: 0 },
    { pose: 'walk_b', g: 'm', at: [0.6, -1.7], face: 0 },
  ],
  cam: { pos: [-0.6, 1.7, 4.6], look: [0, 1.0, -0.7], mm: 50 },
});
add('sc2_look_down', '쓰러진 사람을 내려다봄', ['리액션', '전투'], {
  dolls: [
    { pose: 'lie_back', g: 'm', at: [0, 0], face: 90 },
    { pose: 'stand_head_down', g: 'f', at: [-0.1, 1.15], face: 180 },
  ],
  cam: { pos: [1.6, 2.7, 3.2], look: [0, 0.4, 0.3], mm: 50 },
});
add('sc2_desk_talk', '책상을 사이에 두고 대화', ['대화', '일상'], {
  dolls: [
    { pose: 'sit_chair_upright', g: 'm', at: [-0.5, 0], face: 90 },
    { pose: 'stand_hands_on_hips', g: 'f', at: [0.9, 0], face: -90 },
  ],
  props: [
    { id: 'chair', at: [-0.5, 0], face: 90 },
    { id: 'desk', at: [0.2, 0], face: 90 },
  ],
  cam: { pos: [0.3, 1.6, 4.2], look: [0.2, 0.95, 0], mm: 50 },
});
add('sc2_punch', '주먹을 날리는 순간', ['전투'], {
  dolls: [
    { pose: 'fight_punch', g: 'm', at: [-0.75, 0], face: 90 },
    { pose: 'fight_hit', g: 'm', at: [0.45, 0], face: -90 },
  ],
  cam: { pos: [0.2, 1.4, 3.8], look: [0, 1.05, 0], mm: 50 },
});
add('sc2_sword_duel', '검 대결', ['전투', '대치'], {
  dolls: [
    { pose: 'fight_sword_ready', g: 'm', at: [-0.9, 0], face: 90 },
    { pose: 'fight_sword_ready', g: 'f', at: [0.9, 0], face: -90 },
  ],
  props: [
    { id: 'sword1', hold: { doll: 0, hand: 'right' } },
    { id: 'saber', hold: { doll: 1, hand: 'right' } },
  ],
  cam: { pos: [0.3, 1.4, 4.4], look: [0, 1.0, 0], mm: 50 },
});

// ---------- 3인 ----------
add('sc3_triangle_talk', '삼각 대화', ['대화'], {
  dolls: [
    { pose: 'stand_relaxed', g: 'm', at: [-0.75, 0.2], face: 60 },
    { pose: 'stand_armscrossed', g: 'f', at: [0.75, 0.2], face: -60 },
    { pose: 'stand_hands_on_hips', g: 'm', at: [0, -0.9], face: 180 },
  ],
  cam: { pos: [0.2, 1.8, 4.6], look: [0, 1.0, -0.2], mm: 50 },
});
add('sc3_surround', '한 명을 두 명이 둘러쌈', ['대치', '전투'], {
  dolls: [
    { pose: 'fight_guard', g: 'm', at: [-0.85, 0.1], face: 80 },
    { pose: 'stand_head_down', g: 'f', at: [0, 0], face: 0 },
    { pose: 'fight_guard', g: 'm', at: [0.85, 0.1], face: -80 },
  ],
  cam: { pos: [0.2, 1.6, 4.4], look: [0, 1.0, 0], mm: 50 },
});
add('sc3_lineup', '나란히 서기', ['설정샷', '일상'], {
  dolls: [
    { pose: 'stand_attention', g: 'm', at: [-0.8, 0], face: 0 },
    { pose: 'stand_relaxed', g: 'f', at: [0, 0], face: 0 },
    { pose: 'stand_hands_behind', g: 'm', at: [0.8, 0], face: 0 },
  ],
  cam: { pos: [0, 1.3, 4.6], look: [0, 1.0, 0], mm: 50 },
});

// ---------- 군중 ----------
add('sc_crowd', '군중 배경', ['군중', '설정샷'], {
  dolls: [
    { pose: 'stand_relaxed', g: 'm', at: [-2.2, 0.2], face: 15 },
    { pose: 'walk_a', g: 'f', at: [-1.2, -0.8], face: -20 },
    { pose: 'stand_pockets', g: 'm', at: [-0.3, 0.4], face: 10 },
    { pose: 'stand_armscrossed', g: 'f', at: [0.8, -0.4], face: -10 },
    { pose: 'walk_b', g: 'm', at: [1.8, 0.3], face: 25 },
    { pose: 'stand_hands_on_hips', g: 'f', at: [-1.7, -2.0], face: 0 },
    { pose: 'stand_relaxed', g: 'm', at: [0.2, -1.9], face: -15 },
    { pose: 'stand_look_back', g: 'f', at: [1.3, -2.2], face: 5 },
    { pose: 'stand_attention', g: 'm', at: [-0.6, -3.2], face: 0 },
  ],
  cam: { pos: [0, 3.2, 6.8], look: [0, 0.9, -0.8], mm: 35 },
});

// ---------- 1인 ----------
add('sc1_monologue', '독백(턱 괴기)', ['독백'], {
  dolls: [{ pose: 'stand_chin_hand', g: 'f', at: [0, 0], face: 25 }],
  cam: { pos: [0.5, 1.55, 2.3], look: [0, 1.4, 0], mm: 70 },
});
add('sc1_surprise', '놀란 리액션', ['리액션'], {
  dolls: [{ pose: 'emo_surprise', g: 'm', at: [0, 0], face: -15 }],
  cam: { pos: [-0.3, 1.5, 2.8], look: [0, 1.3, 0], mm: 60 },
});
