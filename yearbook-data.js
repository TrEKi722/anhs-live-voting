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
    { id: 1, name: 'Mr. Mocnik', ext: 'jpeg', gender: 'm' },
    { id: 2, name: 'Coach Calahan', throwbackExt: 'jpeg',gender: 'm' },
    { id: 3, name: 'Mr. Chen', gender: 'm' },
    { id: 4, name: 'Mrs. Desiano', gender: 'f' },
    { id: 5, name: 'Mrs. McCann', throwbackExt: 'jpeg', gender: 'f' },
    { id: 6, name: 'Mrs. Ross', ext: 'jpeg', gender: 'f' },
    { id: 7, name: 'Mr. Golden', currentExt: 'png', gender: 'm' },
    { id: 8, name: 'Coach Colwell', throwbackExt: 'jpeg', currentExt: 'png', gender: 'm' },
    { id: 9, name: 'Srta. Rodriguez', currentExt: 'png', gender: 'f' },
    { id: 10, name: 'Mrs. Akbarzadeh', currentExt: 'png', gender: 'f' },
    { id: 11, name: 'Mrs. Austin', currentExt: 'png', gender: 'f' },
    { id: 12, name: 'Mr. Skinner', currentExt: 'png', gender: 'm' },
    { id: 13, name: 'Mrs. Erhard', currentExt: 'png', gender: 'f' },
    { id: 14, name: 'Mr. Harney', currentExt: 'png', gender: 'm' },
    { id: 15, name: 'Keith', currentExt: 'png', gender: 'm' },
    { id: 16, name: 'Ms. Murphy', currentExt: 'png', gender: 'f' },
    { id: 17, name: 'Mr. Schniepp', throwbackExt: 'png', currentExt: 'png', gender: 'm' },
    { id: 18, name: 'Mr. Silberman', throwbackExt: 'png', currentExt: 'png', gender: 'm' },
    { id: 19, name: 'Mrs. Wright', gender: 'f' },
    { id: 20, name: 'Mr. Mashburn', throwbackExt: 'HEIC', gender: 'm' },
    { id: 21, name: 'Mr. Burns', gender: 'm' },
    { id: 22, name: 'Ms. Long', gender: 'f' }
];
