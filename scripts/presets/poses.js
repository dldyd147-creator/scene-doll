// 기본 포즈 팩 정의(개발 페이지에서 돌려 관절값을 뽑는다). 좌표는 175cm 돌이 원점에 서 있다고 보고, 앞=+z, 바닥 y=0.
// hand/foot(side, out, y, z): out은 몸 중심에서 바깥쪽 거리(안쪽으로 가로지르면 음수). side 'R'은 돌의 오른쪽
// abs(bone, rx, ry, rz): 돌 공간 절대 회전(도). x축=좌우(양수=앞으로 숙임/위쪽 뼈 기준), y=위, z=앞
export const POSES = [];
const add = (id, name, category, tags, build) => POSES.push({ id, name, category, tags, build });

const relaxed = (c) => {
  c.fingers('R', 'relaxed');
  c.fingers('L', 'relaxed');
};
const stand = (c, o = {}) => {
  c.foot('R', o.fr ?? 0.1, 0.075, o.frz ?? 0);
  c.foot('L', o.fl ?? 0.1, 0.075, o.flz ?? 0);
};

// ---------- 서기 ----------
add('stand_attention', '차렷', '서기', ['서기', '정면'], (c) => {
  stand(c);
  c.hand('R', 0.2, 0.78, 0.02);
  c.hand('L', 0.2, 0.78, 0.02);
  relaxed(c);
});
add('stand_relaxed', '편하게 서기', '서기', ['서기', '일상'], (c) => {
  stand(c, { fr: 0.13, frz: -0.03, fl: 0.14, flz: 0.12 });
  c.hand('R', 0.27, 0.8, 0.05);
  c.hand('L', 0.27, 0.8, 0.05);
  c.bend(2);
  relaxed(c);
});
add('stand_armscrossed', '팔짱', '서기', ['서기', '팔짱', '대치'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12 });
  c.hand('R', -0.14, 1.14, 0.2, [0, -1, 0.1]);
  c.hand('L', -0.17, 1.2, 0.25, [0, -1, 0.1]);
  c.fingers('R', 'relaxed');
  c.fingers('L', 'relaxed');
});
add('stand_hands_on_hips', '허리에 손', '서기', ['서기', '자신감'], (c) => {
  stand(c, { fr: 0.15, fl: 0.15 });
  c.hand('R', 0.24, 0.98, -0.03, [1, 0, -0.5]);
  c.hand('L', 0.24, 0.98, -0.03, [1, 0, -0.5]);
  c.fingers('R', 'relaxed');
  c.fingers('L', 'relaxed');
});
add('stand_hands_behind', '뒷짐', '서기', ['서기', '여유'], (c) => {
  stand(c);
  c.hand('R', 0.06, 0.92, -0.2);
  c.hand('L', 0.06, 0.92, -0.2);
  c.fingers('R', 'soft');
  c.fingers('L', 'soft');
});
add('stand_pockets', '주머니에 손', '서기', ['서기', '일상', '여유'], (c) => {
  stand(c, { fr: 0.12, fl: 0.14, flz: 0.08 });
  c.hand('R', 0.17, 0.83, 0.1);
  c.hand('L', 0.17, 0.83, 0.1);
  c.bend(3);
  relaxed(c);
});
add('stand_lean_wall', '벽에 기대어 서기', '서기', ['서기', '기댐'], (c) => {
  stand(c, { fr: 0.12, frz: 0.25, fl: 0.12, flz: 0.32 });
  c.hinge(-12);
  c.hand('R', 0.17, 0.83, 0.08);
  c.hand('L', 0.17, 0.83, 0.08);
  relaxed(c);
});
add('stand_chin_hand', '턱 괴고 서기', '서기', ['서기', '생각'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12 });
  c.hand('R', -0.12, 1.12, 0.22, [0, -1, 0.1]);
  c.hand('L', 0.0, 1.47, 0.19, [0.2, -1, 0.3]);
  c.abs('Head', 12, 0, 0);
  relaxed(c);
});
add('stand_head_down', '고개 숙이고 서기', '서기', ['서기', '풀죽음'], (c) => {
  stand(c);
  c.hand('R', 0.2, 0.78, 0.04);
  c.hand('L', 0.2, 0.78, 0.04);
  c.bend(10);
  c.abs('Head', 30, 0, 0);
  relaxed(c);
});
add('stand_point', '가리키기', '서기', ['서기', '지시'], (c) => {
  stand(c, { fr: 0.14, fl: 0.14, flz: 0.1 });
  c.hand('R', 0.15, 1.42, 0.7);
  c.hand('L', 0.22, 0.8, 0.03);
  c.fingers('R', 'point');
  c.fingers('L', 'relaxed');
});
add('stand_look_back', '뒤돌아보기', '서기', ['서기', '리액션'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12 });
  c.hand('R', 0.22, 0.8, 0.0);
  c.hand('L', 0.22, 0.8, 0.0);
  c.abs('Spine1', 0, 25, 0);
  c.abs('Spine2', 0, 40, 0);
  c.abs('Head', 0, 70, 0);
  relaxed(c);
});
add('stand_step', '한 발 내딛기', '서기', ['서기', '이동'], (c) => {
  c.foot('R', 0.11, 0.075, 0.38);
  c.foot('L', 0.11, 0.075, -0.1);
  c.hand('R', 0.28, 0.85, -0.12);
  c.hand('L', 0.26, 0.85, 0.12);
  c.bend(4);
  relaxed(c);
});

// ---------- 앉기 ----------
const chair = (c, o = {}) => {
  c.low(0.44);
  c.foot('R', o.fr ?? 0.12, 0.075, o.frz ?? 0.4);
  c.foot('L', o.fl ?? 0.12, 0.075, o.flz ?? 0.4);
};
add('sit_chair_upright', '의자에 앉기(정자세)', '앉기', ['앉기', '의자'], (c) => {
  chair(c);
  c.hand('R', 0.16, 0.58, 0.22);
  c.hand('L', 0.16, 0.58, 0.22);
  relaxed(c);
});
add('sit_chair_lean', '의자에 기대어 앉기', '앉기', ['앉기', '의자', '여유'], (c) => {
  chair(c, { frz: 0.5, flz: 0.45 });
  c.hinge(-14);
  c.hand('R', 0.22, 0.52, 0.05);
  c.hand('L', 0.22, 0.52, 0.05);
  relaxed(c);
});
add('sit_chair_crossed', '다리 꼬고 앉기', '앉기', ['앉기', '의자', '여유'], (c) => {
  c.low(0.44);
  c.foot('L', 0.1, 0.075, 0.32);
  c.foot('R', -0.1, 0.42, 0.3, false);
  c.hand('R', -0.05, 0.7, 0.32);
  c.hand('L', 0.2, 0.56, 0.2);
  relaxed(c);
});
add('sit_floor_crossed', '바닥에 앉기(양반다리)', '앉기', ['앉기', '바닥'], (c) => {
  c.low(0.86);
  c.foot('R', 0.12, 0.1, 0.28, false);
  c.foot('L', 0.12, 0.1, 0.3, false);
  c.hand('R', 0.2, 0.2, 0.28);
  c.hand('L', 0.2, 0.2, 0.28);
  relaxed(c);
});
add('sit_floor_knees_hug', '무릎 껴안고 앉기', '앉기', ['앉기', '바닥', '풀죽음'], (c) => {
  c.low(0.86);
  c.foot('R', 0.1, 0.075, 0.22);
  c.foot('L', 0.1, 0.075, 0.22);
  c.hinge(25);
  c.hand('R', 0.08, 0.42, 0.34);
  c.hand('L', 0.08, 0.42, 0.34);
  c.abs('Head', 20, 0, 0);
  relaxed(c);
});
add('sit_squat', '쪼그려 앉기', '앉기', ['앉기', '쪼그림'], (c) => {
  c.low(0.55);
  c.foot('R', 0.14, 0.075, 0.1);
  c.foot('L', 0.14, 0.075, 0.1);
  c.hinge(35);
  c.hand('R', 0.2, 0.45, 0.32);
  c.hand('L', 0.2, 0.45, 0.32);
  relaxed(c);
});
add('sit_desk_sleep', '책상에 엎드리기', '앉기', ['앉기', '의자', '엎드림'], (c) => {
  chair(c);
  c.hinge(68);
  c.hand('R', 0.14, 0.76, 0.52, [0.8, -0.3, 0]);
  c.hand('L', 0.14, 0.76, 0.52, [0.8, -0.3, 0]);
  c.abs('Head', 20, 55, 0);
  relaxed(c);
});
add('sit_chair_forward', '의자에서 앞으로 숙이기', '앉기', ['앉기', '의자', '고민'], (c) => {
  chair(c);
  c.hinge(35);
  c.hand('R', 0.1, 0.52, 0.34);
  c.hand('L', 0.1, 0.52, 0.34);
  c.abs('Head', 10, 0, 0);
  relaxed(c);
});
add('sit_edge', '걸터앉기', '앉기', ['앉기', '걸터앉음'], (c) => {
  c.low(0.5);
  c.foot('R', 0.12, 0.075, 0.2);
  c.foot('L', 0.12, 0.2, 0.42, false);
  c.hand('R', 0.18, 0.5, 0.1);
  c.hand('L', 0.18, 0.5, 0.1);
  c.hinge(8);
  relaxed(c);
});
add('sit_kneel', '무릎 꿇기(정좌)', '앉기', ['앉기', '정좌'], (c) => {
  c.low(0.78);
  c.foot('R', 0.08, 0.075, -0.2, false);
  c.foot('L', 0.08, 0.075, -0.2, false);
  c.hand('R', 0.12, 0.28, 0.22);
  c.hand('L', 0.12, 0.28, 0.22);
  relaxed(c);
});

// ---------- 눕기 ----------
add('lie_back', '반듯이 눕기', '눕기', ['눕기'], (c) => {
  c.abs('Hips', -90, 0, 0);
  c.low(0.86);
  c.hand('R', 0.22, 0.1, 0.0, [1, 0.2, 0]);
  c.hand('L', 0.22, 0.1, 0.0, [1, 0.2, 0]);
  relaxed(c);
});
add('lie_side', '옆으로 눕기', '눕기', ['눕기', '옆'], (c) => {
  c.abs('Hips', 0, 0, -90);
  c.low(0.86);
  c.hand('R', 0.0, 0.34, 0.12, [0, 1, 0.3]);
  c.hand('L', 0.5, 0.1, 0.28, [0, 0.3, 1]);
  relaxed(c);
});
add('lie_belly', '엎드려 눕기', '눕기', ['눕기', '엎드림'], (c) => {
  c.abs('Hips', 90, 0, 0);
  c.low(0.86);
  c.hand('R', 0.22, 0.1, 0.0, [1, 0.2, 0]);
  c.hand('L', 0.22, 0.1, 0.0, [1, 0.2, 0]);
  relaxed(c);
});
add('lie_head_arm', '팔 베고 눕기', '눕기', ['눕기', '여유'], (c) => {
  c.abs('Hips', -90, 0, 0);
  c.low(0.86);
  c.hand('R', 0.2, 0.12, -0.52, [1, 0.5, 0]);
  c.hand('L', 0.22, 0.1, 0.0, [1, 0.2, 0]);
  relaxed(c);
});

// ---------- 걷기·뛰기 ----------
add('walk_a', '걷기 A', '걷기·뛰기', ['걷기', '이동'], (c) => {
  c.foot('R', 0.1, 0.075, 0.36);
  c.foot('L', 0.1, 0.2, -0.3, false);
  c.hand('R', 0.26, 1.0, -0.15);
  c.hand('L', 0.2, 1.0, 0.3);
  c.bend(4);
  relaxed(c);
});
add('walk_b', '걷기 B(디딤)', '걷기·뛰기', ['걷기', '이동'], (c) => {
  c.foot('R', 0.1, 0.075, 0.08);
  c.foot('L', 0.1, 0.075, -0.08);
  c.hand('R', 0.25, 0.9, -0.08);
  c.hand('L', 0.2, 0.92, 0.12);
  c.bend(3);
  relaxed(c);
});
add('run_a', '달리기 A', '걷기·뛰기', ['달리기', '이동', '급함'], (c) => {
  c.foot('R', 0.1, 0.5, 0.35, false);
  c.foot('L', 0.12, 0.3, -0.5, false);
  c.hinge(14);
  c.hand('R', 0.3, 1.2, -0.25);
  c.hand('L', 0.22, 1.18, 0.32);
  c.fingers('R', 'soft');
  c.fingers('L', 'soft');
});
add('run_b', '달리기 B(반대 발)', '걷기·뛰기', ['달리기', '이동', '급함'], (c) => {
  c.foot('R', 0.12, 0.3, -0.5, false);
  c.foot('L', 0.1, 0.5, 0.35, false);
  c.hinge(14);
  c.hand('R', 0.22, 1.18, 0.32);
  c.hand('L', 0.3, 1.2, -0.25);
  c.fingers('R', 'soft');
  c.fingers('L', 'soft');
});
add('walk_hesitate', '멈칫', '걷기·뛰기', ['멈칫', '리액션'], (c) => {
  c.foot('R', 0.1, 0.075, 0.12);
  c.foot('L', 0.1, 0.12, -0.15, false);
  c.hinge(-8);
  c.hand('R', 0.4, 1.0, 0.1);
  c.hand('L', 0.35, 1.0, 0.05);
  relaxed(c);
});
add('stairs_up', '계단 오르기', '걷기·뛰기', ['이동', '계단'], (c) => {
  c.foot('R', 0.1, 0.075, 0.3);
  c.foot('L', 0.1, 0.28, 0.35, false);
  c.hinge(10);
  c.hand('R', 0.25, 0.9, -0.1);
  c.hand('L', 0.2, 1.0, 0.25);
  relaxed(c);
});

// ---------- 동작 ----------
add('act_wave', '손 흔들기', '동작', ['인사', '손짓'], (c) => {
  stand(c);
  c.hand('R', 0.32, 1.78, 0.12);
  c.hand('L', 0.22, 0.8, 0.02);
  c.fingers('R', 'open');
  c.fingers('L', 'relaxed');
});
add('act_pickup', '물건 집기', '동작', ['집기', '숙임'], (c) => {
  stand(c, { fr: 0.14, fl: 0.14, flz: 0.15 });
  c.hinge(55);
  c.hand('R', 0.12, 0.3, 0.45);
  c.hand('L', 0.2, 0.6, 0.0);
  c.fingers('R', 'grip');
  c.fingers('L', 'relaxed');
});
add('act_stretch', '기지개', '동작', ['기지개', '일상'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12 });
  c.hand('R', 0.12, 2.05, -0.02);
  c.hand('L', 0.12, 2.05, -0.02);
  c.bend(-12);
  c.fingers('R', 'soft');
  c.fingers('L', 'soft');
});
add('act_bow', '인사(숙임)', '동작', ['인사', '정중'], (c) => {
  stand(c);
  c.hinge(48);
  c.hand('R', 0.16, 0.6, 0.18);
  c.hand('L', 0.16, 0.6, 0.18);
  c.abs('Head', 10, 0, 0);
  relaxed(c);
});
add('act_clap', '박수', '동작', ['박수', '기쁨'], (c) => {
  stand(c);
  c.hand('R', 0.03, 1.28, 0.3);
  c.hand('L', 0.03, 1.28, 0.3);
  c.fingers('R', 'open');
  c.fingers('L', 'open');
});
add('act_door', '문 열기', '동작', ['문', '손잡이'], (c) => {
  stand(c, { fr: 0.14, fl: 0.14, flz: -0.05, frz: 0.12 });
  c.hand('R', 0.2, 1.0, 0.55);
  c.hand('L', 0.24, 0.85, 0.0);
  c.hinge(6);
  c.fingers('R', 'grip');
  c.fingers('L', 'relaxed');
});
add('act_stumble', '넘어지려는 순간', '동작', ['넘어짐', '위기'], (c) => {
  c.foot('R', 0.1, 0.075, 0.3);
  c.foot('L', 0.1, 0.55, -0.3, false);
  c.hinge(28);
  c.hand('R', 0.55, 1.5, 0.35);
  c.hand('L', 0.5, 1.2, -0.2);
  c.fingers('R', 'open');
  c.fingers('L', 'open');
});
add('act_throw', '던지기', '동작', ['던지기'], (c) => {
  c.foot('R', 0.12, 0.075, -0.25);
  c.foot('L', 0.15, 0.075, 0.3);
  c.hand('R', 0.3, 1.8, -0.3);
  c.hand('L', 0.2, 1.3, 0.45);
  c.hinge(-5);
  c.fingers('R', 'grip');
  c.fingers('L', 'open');
});

// ---------- 전투 ----------
const guard = (c) => {
  c.low(0.1);
  c.foot('R', 0.2, 0.075, -0.2);
  c.foot('L', 0.1, 0.075, 0.28);
};
add('fight_guard', '격투 자세', '전투', ['전투', '대치'], (c) => {
  guard(c);
  c.hand('R', 0.14, 1.38, 0.32);
  c.hand('L', 0.1, 1.34, 0.45);
  c.fingers('R', 'fist');
  c.fingers('L', 'fist');
  c.hinge(6);
});
add('fight_punch', '펀치', '전투', ['전투', '공격'], (c) => {
  guard(c);
  c.hand('L', 0.1, 1.38, 0.82);
  c.hand('R', 0.18, 1.3, 0.2);
  c.fingers('R', 'fist');
  c.fingers('L', 'fist');
  c.hinge(10);
  c.abs('Spine2', 0, -20, 0);
});
add('fight_kick', '발차기', '전투', ['전투', '공격'], (c) => {
  c.foot('L', 0.15, 0.075, 0.0);
  c.foot('R', 0.1, 1.05, 0.7, false);
  c.hinge(-18);
  c.hand('R', 0.45, 1.45, 0.0);
  c.hand('L', 0.45, 1.5, -0.1);
  c.fingers('R', 'fist');
  c.fingers('L', 'fist');
});
add('fight_sword_ready', '검 겨누기', '전투', ['전투', '검', '대치'], (c) => {
  c.low(0.08);
  c.foot('R', 0.17, 0.075, -0.2);
  c.foot('L', 0.1, 0.075, 0.3);
  c.hand('R', 0.1, 1.15, 0.5);
  c.hand('L', 0.04, 1.1, 0.42);
  c.fingers('R', 'grip');
  c.fingers('L', 'grip');
});
add('fight_sword_slash', '검 내려치기', '전투', ['전투', '검', '공격'], (c) => {
  c.low(0.08);
  c.foot('R', 0.17, 0.075, -0.25);
  c.foot('L', 0.12, 0.075, 0.35);
  c.hand('R', 0.16, 1.95, 0.05);
  c.hand('L', 0.04, 1.8, 0.0);
  c.hinge(8);
  c.fingers('R', 'grip');
  c.fingers('L', 'grip');
});
add('fight_block', '막기(팔 올림)', '전투', ['전투', '방어'], (c) => {
  c.low(0.08);
  c.foot('R', 0.16, 0.075, -0.15);
  c.foot('L', 0.1, 0.075, 0.2);
  c.hand('R', 0.18, 1.75, 0.35);
  c.hand('L', 0.1, 1.72, 0.38);
  c.hinge(12);
  c.fingers('R', 'fist');
  c.fingers('L', 'fist');
});
add('fight_dodge', '회피(뒤로 젖힘)', '전투', ['전투', '회피'], (c) => {
  c.foot('R', 0.12, 0.075, -0.3);
  c.foot('L', 0.14, 0.075, 0.2);
  c.hinge(-30);
  c.hand('R', 0.4, 1.3, 0.1);
  c.hand('L', 0.3, 1.0, 0.4);
  c.fingers('R', 'soft');
  c.fingers('L', 'soft');
});
add('fight_hit', '피격(고개 젖힘)', '전투', ['전투', '피격'], (c) => {
  c.foot('R', 0.12, 0.075, -0.2);
  c.foot('L', 0.14, 0.075, 0.12);
  c.hinge(-18);
  c.abs('Head', -25, 20, 0);
  c.hand('R', 0.5, 1.25, 0.0);
  c.hand('L', 0.45, 1.05, -0.1);
  c.fingers('R', 'open');
  c.fingers('L', 'open');
});
add('fight_one_knee', '한쪽 무릎 꿇기', '전투', ['전투', '무릎'], (c) => {
  c.low(0.45);
  c.foot('L', 0.14, 0.075, 0.42);
  c.foot('R', 0.1, 0.1, -0.3, false);
  c.hinge(18);
  c.hand('L', 0.2, 0.55, 0.3);
  c.hand('R', 0.2, 0.2, 0.2);
  relaxed(c);
});
add('fight_aim_pistol', '권총 겨누기', '전투', ['전투', '총'], (c) => {
  c.low(0.04);
  c.foot('R', 0.14, 0.075, -0.1);
  c.foot('L', 0.12, 0.075, 0.22);
  c.hand('R', 0.1, 1.42, 0.7);
  c.hand('L', 0.02, 1.4, 0.62);
  c.fingers('R', 'grip');
  c.fingers('L', 'grip');
});

// ---------- 감정 ----------
add('emo_surprise', '놀람', '감정', ['놀람', '리액션'], (c) => {
  c.foot('R', 0.13, 0.075, -0.15);
  c.foot('L', 0.13, 0.075, 0.1);
  c.hinge(-14);
  c.hand('R', 0.4, 1.35, 0.3);
  c.hand('L', 0.4, 1.35, 0.3);
  c.fingers('R', 'open');
  c.fingers('L', 'open');
});
add('emo_sad', '슬픔', '감정', ['슬픔', '풀죽음'], (c) => {
  stand(c, { fr: 0.1, fl: 0.1 });
  c.hinge(12);
  c.abs('Head', 38, 0, 0);
  c.hand('R', 0.18, 0.7, 0.1);
  c.hand('L', 0.18, 0.7, 0.1);
  relaxed(c);
});
add('emo_anger', '분노', '감정', ['분노', '대치'], (c) => {
  stand(c, { fr: 0.15, fl: 0.15 });
  c.hinge(10);
  c.hand('R', 0.28, 0.88, 0.05);
  c.hand('L', 0.28, 0.88, 0.05);
  c.fingers('R', 'fist');
  c.fingers('L', 'fist');
  c.abs('Head', 8, 0, 0);
});
add('emo_shy', '부끄러움', '감정', ['부끄러움', '리액션'], (c) => {
  stand(c, { fr: 0.08, fl: 0.08 });
  c.hand('R', 0.04, 1.52, 0.2, [0.4, -1, 0.2]);
  c.hand('L', 0.04, 1.5, 0.2, [0.4, -1, 0.2]);
  c.abs('Head', 18, 0, 0);
  c.fingers('R', 'open');
  c.fingers('L', 'open');
});
add('emo_joy', '기쁨(두 팔 올림)', '감정', ['기쁨', '환호'], (c) => {
  stand(c, { fr: 0.14, fl: 0.14 });
  c.hand('R', 0.5, 1.95, 0.1);
  c.hand('L', 0.5, 1.95, 0.1);
  c.hinge(-6);
  c.fingers('R', 'open');
  c.fingers('L', 'open');
});
add('emo_hug_ready', '포옹 준비', '감정', ['포옹', '로맨스'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12, flz: 0.1 });
  c.hand('R', 0.55, 1.25, 0.55);
  c.hand('L', 0.55, 1.25, 0.55);
  c.fingers('R', 'open');
  c.fingers('L', 'open');
});
add('emo_head_hold', '머리 감싸기', '감정', ['고뇌', '충격'], (c) => {
  stand(c, { fr: 0.1, fl: 0.1 });
  c.hand('R', 0.17, 1.7, 0.03, [1, 0, 0]);
  c.hand('L', 0.17, 1.7, 0.03, [1, 0, 0]);
  c.hinge(10);
  c.abs('Head', 20, 0, 0);
  c.fingers('R', 'claw');
  c.fingers('L', 'claw');
});
add('emo_shrug', '어깨 으쓱', '감정', ['으쓱', '황당'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12 });
  c.hand('R', 0.45, 1.05, 0.25);
  c.hand('L', 0.45, 1.05, 0.25);
  c.abs('Head', 0, 0, -10);
  c.fingers('R', 'open');
  c.fingers('L', 'open');
});
add('emo_sigh', '한숨(이마 짚기)', '감정', ['한숨', '피곤'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12 });
  c.hand('R', 0.03, 1.7, 0.13, [0.7, -0.6, 0.2]);
  c.hand('L', 0.2, 0.85, 0.03);
  c.hinge(8);
  c.abs('Head', 12, 0, 0);
  c.fingers('R', 'open');
  c.fingers('L', 'relaxed');
});

// ---------- 일반 ----------
add('gen_phone_call', '통화', '일반', ['통화', '스마트폰'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12 });
  c.hand('R', 0.12, 1.6, 0.06, [0.7, -1, 0.1]);
  c.hand('L', -0.1, 1.12, 0.2, [0, -1, 0.1]);
  c.fingers('R', 'phone');
  c.fingers('L', 'relaxed');
});
add('gen_phone_look', '스마트폰 보기', '일반', ['스마트폰'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12 });
  c.hand('R', 0.06, 1.2, 0.28, [0.5, -1, 0]);
  c.hand('L', 0.06, 1.2, 0.28, [0.5, -1, 0]);
  c.abs('Head', 25, 0, 0);
  c.hinge(6);
  c.fingers('R', 'phone');
  c.fingers('L', 'phone');
});
add('gen_read', '책 읽기', '일반', ['독서'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12 });
  c.hand('R', 0.1, 1.18, 0.3, [0.5, -1, 0]);
  c.hand('L', 0.1, 1.18, 0.3, [0.5, -1, 0]);
  c.abs('Head', 22, 0, 0);
  c.fingers('R', 'phone');
  c.fingers('L', 'phone');
});
add('gen_drink', '마시기', '일반', ['음료'], (c) => {
  stand(c, { fr: 0.12, fl: 0.12 });
  c.hand('R', 0.03, 1.46, 0.24, [0.4, -1, 0]);
  c.hand('L', 0.2, 0.85, 0.03);
  c.abs('Head', -10, 0, 0);
  c.fingers('R', 'grip');
  c.fingers('L', 'relaxed');
});
add('gen_write', '책상에서 글쓰기', '일반', ['글쓰기', '의자'], (c) => {
  chair(c, { frz: 0.3, flz: 0.3 });
  c.hinge(22);
  c.hand('R', 0.1, 0.76, 0.42, [0.5, -1, -0.1]);
  c.hand('L', 0.2, 0.76, 0.3, [0.5, -1, -0.1]);
  c.abs('Head', 20, 0, 0);
  c.fingers('R', 'pen');
  c.fingers('L', 'relaxed');
});
add('gen_laptop', '노트북 타자', '일반', ['노트북', '의자'], (c) => {
  chair(c, { frz: 0.3, flz: 0.3 });
  c.hinge(12);
  c.hand('R', 0.09, 0.78, 0.42, [0.5, -1, -0.1]);
  c.hand('L', 0.09, 0.78, 0.42, [0.5, -1, -0.1]);
  c.abs('Head', 12, 0, 0);
  c.fingers('R', 'tense');
  c.fingers('L', 'tense');
});
add('gen_drive', '운전', '일반', ['운전', '의자'], (c) => {
  c.low(0.44);
  c.foot('R', 0.12, 0.075, 0.45);
  c.foot('L', 0.12, 0.075, 0.45);
  c.hinge(-8);
  c.hand('R', 0.2, 0.88, 0.42, [0.6, -1, 0]);
  c.hand('L', 0.2, 0.88, 0.42, [0.6, -1, 0]);
  c.fingers('R', 'grip');
  c.fingers('L', 'grip');
});
add('gen_eat', '밥 먹기', '일반', ['식사', '의자'], (c) => {
  chair(c, { frz: 0.3, flz: 0.3 });
  c.hinge(10);
  c.hand('R', 0.03, 0.98, 0.3, [0.4, -1, 0]);
  c.hand('L', 0.12, 0.76, 0.32, [0.5, -1, -0.1]);
  c.fingers('R', 'pen');
  c.fingers('L', 'relaxed');
});
