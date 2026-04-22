// ==========================================
// Name Game — Image Sets Configuration
// ==========================================
// Add images to /media/name-game/<set-key>/ and list them here.
// Each image can have multiple acceptable answers (case-insensitive).
// ==========================================

const NAME_GAME_SETS = {
    set_a: {
        name: "Set A",
        images: [
            // ── Easy ──────────────────────────────────────────────────
            { path: "/media/name-game/set-a/001.jpg", answers: ["pencil", "pencils"] },
            { path: "/media/name-game/set-a/002.avif", answers: ["stapler", "staplers"] },
            { path: "/media/name-game/set-a/003.jpg", answers: ["calculator", "calc", "calculators"] },
            { path: "/media/name-game/set-a/004.jpg", answers: ["eraser", "rubber", "erasers", "rubbers"] },
            { path: "/media/name-game/set-a/005.avif", answers: ["sticky note", "post-it", "post it", "postit", "sticky notes", "post-its", "sticky pad"] },
            { path: "/media/name-game/set-a/006.webp", answers: ["headphones", "headphone", "earphones", "earphone", "cans", "over-ear headphones"] },
            { path: "/media/name-game/set-a/007.avif", answers: ["notebook", "composition notebook", "spiral notebook", "notepad", "binder", "composition book"] },
            { path: "/media/name-game/set-a/008.jpg", answers: ["whiteboard marker", "dry erase marker", "dry-erase marker", "marker", "expo marker", "expo", "board marker", "whiteboard pen", "dry erase pen"] },
            { path: "/media/name-game/set-a/009.webp", answers: ["paper clip", "paperclip", "paper clips", "paperclips", "clip"] },
            { path: "/media/name-game/set-a/010.png", answers: ["usb drive", "usb", "flash drive", "thumbdrive", "thumb drive", "memory stick", "usb stick", "pen drive", "flash disk"] },
            // ── Medium ────────────────────────────────────────────────
            { path: "/media/name-game/set-a/011.webp", answers: ["protractor", "angle ruler", "semicircle ruler"] },
            { path: "/media/name-game/set-a/012.jpg", answers: ["hole punch", "hole puncher", "paper punch", "puncher", "punch", "hole punching machine", "3 hole punch", "three hole punch"] },
            { path: "/media/name-game/set-a/013.jpg", answers: ["index card", "note card", "flashcard", "flash card", "index cards", "note cards", "flashcards", "cue card", "cue cards", "recipe card","notecards"] },
            { path: "/media/name-game/set-a/014.jpg", answers: ["correction tape", "white out", "wite-out", "wite out", "whiteout", "correction fluid", "tipex", "tipp-ex", "tipp ex"] },
            { path: "/media/name-game/set-a/015.jpg", answers: ["label maker", "label printer", "label machine", "dymo", "labelmaker"] },
            { path: "/media/name-game/set-a/016.avif", answers: ["padlock", "pad lock", "lock", "combination lock", "combo lock","master lock"] },
            { path: "/media/name-game/set-a/017.webp", answers: ["rubberband ball", "rubber band ball", "rubber band", "elastic band ball", "rubber ball", "band ball"] },
            { path: "/media/name-game/set-a/018.jpg", answers: ["bulldog clip", "foldback clip", "fold back clip", "binder clamp", "binder clip", "paper clamp", "large clip", "metal clip", "spring clip", "jaw clip"] },
            { path: "/media/name-game/set-a/019.jpg", answers: ["standoff screw", "standoff", "standoffs", "pcb standoff", "hex standoff", "motherboard standoff", "circuit board standoff"] },
            { path: "/media/name-game/set-a/020.jpg", answers: ["wire stripper", "wire strippers", "wire stripper tool", "cable stripper", "strippers"] },
            // ── Hard ──────────────────────────────────────────────────
            { path: "/media/name-game/set-a/021.webp", answers: ["grommet", "grommets", "eyelet grommet", "rubber grommet", "cable grommet", "wire grommet"] },
            { path: "/media/name-game/set-a/022.jpg", answers: ["eyelet", "eyelets", "eyelet ring", "grommet", "rivet eyelet"] },
            { path: "/media/name-game/set-a/023.jpg", answers: ["ferrite bead", "ferrite", "ferrite core", "ferrite choke", "ferrite ring", "ferrite clip", "emi filter", "noise filter", "cable ferrite"] },
            { path: "/media/name-game/set-a/024.avif", answers: ["hex key", "allen wrench", "allen key", "hex wrench", "hex driver", "allen", "l wrench", "inbus key", "hexagon key"] },
            { path: "/media/name-game/set-a/025.jpg", answers: ["cotter pin", "cotter", "split pin", "hair pin", "hair clip pin", "linchpin", "lynchpin", "cotter key"] },
        ]
    },
    set_b: {
        name: "Set B",
        images: [
            // ── Easy ──────────────────────────────────────────────────
            { path: "/media/name-game/set-b/001.webp", answers: ["highlighter", "highlight marker", "highlighter pen", "highlighters", "fluorescent marker", "text marker"] },
            { path: "/media/name-game/set-b/002.webp", answers: ["scissors", "scissor", "shears", "pair of scissors"] },
            { path: "/media/name-game/set-b/003.webp", answers: ["ruler", "rulers", "straight edge", "straightedge", "measuring stick", "rule"] },
            { path: "/media/name-game/set-b/004.avif", answers: ["tape dispenser", "tape", "scotch tape", "tape holder", "tape gun", "sticky tape", "sellotape", "selotape", "desk tape", "tape roll"] },
            { path: "/media/name-game/set-b/005.jpg", answers: ["water bottle", "water", "bottle", "water bottles", "hydro flask", "hydroflask", "drink bottle", "reusable bottle", "tumbler"] },
            { path: "/media/name-game/set-b/006.webp", answers: ["backpack", "back pack", "bag", "school bag", "rucksack", "bookbag", "book bag", "knapsack", "pack"] },
            { path: "/media/name-game/set-b/007.jpg", answers: ["phone", "cell phone", "mobile", "mobile phone", "smartphone", "iphone", "android", "cellphone"] },
            { path: "/media/name-game/set-b/008.webp", answers: ["laptop", "computer", "notebook computer", "macbook", "mac", "chromebook", "notebook laptop"] },
            { path: "/media/name-game/set-b/009.jpg", answers: ["glue stick", "glue", "glue sticks", "stick glue", "uhu", "glue stick pen"] },
            { path: "/media/name-game/set-b/010.webp", answers: ["rubber band", "elastic band", "rubber bands", "elastic bands", "band", "elastic", "hair band", "hair tie"] },
            // ── Medium ────────────────────────────────────────────────
            { path: "/media/name-game/set-b/011.webp", answers: ["compass", "drawing compass", "geometry compass", "math compass", "pair of compasses", "compasses", "circle maker", "drafting compass"] },
            { path: "/media/name-game/set-b/012.jpg", answers: ["binder clip", "binder clips", "fold back clip", "foldback clip", "medium clip", "office clip", "spring binder clip", "black clip", "butterfly clip", "claw clip"] },
            { path: "/media/name-game/set-b/013.jpg", answers: ["lanyard", "lanyards", "neck strap", "id lanyard", "badge lanyard", "key lanyard", "id holder strap","keychain"] },
            { path: "/media/name-game/set-b/014.jpg", answers: ["push pin", "pushpin", "thumbtack", "thumb tack", "tack", "drawing pin", "push pins", "bulletin pin", "board pin"] },
            { path: "/media/name-game/set-b/015.jpg", answers: ["paper tray", "paper organizer", "desk tray", "file tray", "letter tray", "in tray", "out tray", "inbox tray", "document tray"] },
            { path: "/media/name-game/set-b/016.jpg", answers: ["sticky note dispenser", "post-it dispenser", "note dispenser", "sticky note holder", "post it dispenser", "note holder"] },
            { path: "/media/name-game/set-b/017.jpg", answers: ["cable tie", "cable ties", "zip tie", "zip ties", "wire tie", "wire ties", "tie wrap", "tie wraps", "nylon tie", "velcro tie"] },
            { path: "/media/name-game/set-b/018.jpg", answers: ["seam ripper", "seam rippers", "stitch ripper", "stitch unpicker", "thread ripper", "sewing ripper", "sewing unpicker", "unpicker"] },
            { path: "/media/name-game/set-b/019.jpg", answers: ["hex key", "allen key", "allen wrench", "hex wrench", "hex driver", "allen", "l wrench", "inbus key", "hexagon key"] },
            { path: "/media/name-game/set-b/020.jpg", answers: ["wire stripper", "wire strippers", "cable stripper", "strippers", "wire stripper tool"] },
            // ── Hard ──────────────────────────────────────────────────
            { path: "/media/name-game/set-b/021.jpg", answers: ["cotter pin", "cotter", "split pin", "hair pin", "linchpin", "lynchpin", "cotter key"] },
            { path: "/media/name-game/set-b/022.jpg", answers: ["zip tie", "zip ties", "cable tie", "cable ties", "wire tie", "nylon tie", "ty-rap", "tyrап"] },
            { path: "/media/name-game/set-b/023.jpg", answers: ["standoff screw", "standoff", "standoffs", "pcb standoff", "hex standoff", "motherboard standoff", "circuit board standoff"] },
            { path: "/media/name-game/set-b/024.jpg", answers: ["wire stripper", "wire strippers", "cable stripper", "strippers", "wire stripper tool"] },
            { path: "/media/name-game/set-b/025.jpg", answers: ["grommet", "grommets", "rubber grommet", "cable grommet", "wire grommet", "eyelet grommet"] },
        ]
    }
};