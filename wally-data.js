// ==========================================
// Find Wally — Scene Data
// ==========================================
// hitbox: x, y = center of Wally as % of image natural dimensions (0–100)
//         radius = tolerance radius as % of image natural width
//
// To calibrate hitbox coordinates:
//   1. Drop your scene image in /media/wally/
//   2. Start a round from admin
//   3. Open browser console and tap where Wally is
//   4. Read the logged "Tap at: X% Y%" values and update x/y below
//   5. Adjust radius to taste (5 = roughly 5% of image width)

const WALLY_SCENES = [
    {
        id: 'scene_01',
        name: 'Scene 1',
        image: '/media/wally/scene_01.jpg',
        hitbox: { x: 1160, y: 500, radius: 20 }  // TODO: update after placing scene image
    }
];
