// ==========================================
// Yearbook Game — Teacher Data
// ==========================================
// Add one entry per teacher. Photos go in:
//   media/teachers/throwbacks/<id>.<throwbackExt>  (middle school photo)
//   media/teachers/current/<id>.<currentExt>       (current photo)
// Use `throwbackExt` and `currentExt` for per-photo extensions.
// Or use `ext` to set the same extension for both. Defaults to 'jpg'.
// Use `gender` ('m' or 'f') so decoy options are always same-gender.

const YEARBOOK_TEACHERS = [
    { id: 0, name: 'Coach Henderson', throwbackExt: 'jpeg', currentExt: 'png', gender: 'm' },
    { id: 1, name: 'Mr. Smith', gender: 'm' },
    { id: 2, name: 'Ms. Davis', gender: 'f' },
    { id: 3, name: 'Mr. Martinez', gender: 'm' },
    { id: 4, name: 'Ms. Wilson', gender: 'f' },
    { id: 5, name: 'Mr. Anderson', gender: 'm' },
    { id: 6, name: 'Ms. Taylor', gender: 'f' },
    { id: 7, name: 'Mr. Thomas', gender: 'm' },
];
