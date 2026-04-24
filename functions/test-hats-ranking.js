/**
 * Test suite for Cups (Hats) leaderboard ranking logic
 *
 * Run with: node test-hats-ranking.js
 *
 * This tests the core sorting and ranking algorithm used by onHatsPressWrite
 * without requiring Firebase connection.
 */

// Simulate the ranking logic from onHatsPressWrite
function rankCupPresses(presses, correctOption) {
  if (!correctOption || correctOption === null) {
    return [];
  }

  const correctPresses = presses.filter(p => p.choice === correctOption);

  const ranked = correctPresses.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (timeA !== timeB) return timeA - timeB;
    return String(a.id).localeCompare(String(b.id));
  });

  return ranked.slice(0, 5).map((d, idx) => ({
    rank: idx + 1,
    id: d.id,
    display_name: d.display_name || 'Anonymous',
    timestamp: d.timestamp,
  }));
}

// Test helper
function testPasses(actual, expected, testName) {
  const actualStr = JSON.stringify(actual.map(a => ({ rank: a.rank, id: a.id, display_name: a.display_name })));
  const expectedStr = JSON.stringify(expected.map(e => ({ rank: e.rank, id: e.id, display_name: e.display_name })));
  return actualStr === expectedStr;
}

// Test cases
const tests = [];

tests.push({
  name: 'Basic timestamp ordering',
  presses: [
    { id: 'user1', choice: 2, timestamp: '2025-04-23T21:02:20.000Z', display_name: 'azure-tiger' },
    { id: 'user2', choice: 2, timestamp: '2025-04-23T21:02:15.000Z', display_name: 'stellar-wolf' },
    { id: 'user3', choice: 2, timestamp: '2025-04-23T21:02:25.000Z', display_name: 'crimson-bear' },
  ],
  correctOption: 2,
  expected: [
    { rank: 1, id: 'user2', display_name: 'stellar-wolf' },
    { rank: 2, id: 'user1', display_name: 'azure-tiger' },
    { rank: 3, id: 'user3', display_name: 'crimson-bear' },
  ],
});

tests.push({
  name: 'Filter out wrong answers',
  presses: [
    { id: 'user1', choice: 1, timestamp: '2025-04-23T21:02:15.000Z', display_name: 'wrong-user' },
    { id: 'user2', choice: 2, timestamp: '2025-04-23T21:02:16.000Z', display_name: 'correct-user' },
  ],
  correctOption: 2,
  expected: [
    { rank: 1, id: 'user2', display_name: 'correct-user' },
  ],
});

tests.push({
  name: 'Tie-breaker with identical timestamps (alphabetical by ID)',
  presses: [
    { id: 'zebra', choice: 2, timestamp: '2025-04-23T21:02:15.000Z', display_name: 'Z User' },
    { id: 'alpha', choice: 2, timestamp: '2025-04-23T21:02:15.000Z', display_name: 'A User' },
    { id: 'beta', choice: 2, timestamp: '2025-04-23T21:02:15.000Z', display_name: 'B User' },
  ],
  correctOption: 2,
  expected: [
    { rank: 1, id: 'alpha', display_name: 'A User' },
    { rank: 2, id: 'beta', display_name: 'B User' },
    { rank: 3, id: 'zebra', display_name: 'Z User' },
  ],
});

tests.push({
  name: 'Limit to top 5',
  presses: Array.from({ length: 10 }, (_, i) => ({
    id: `user${i}`,
    choice: 2,
    timestamp: `2025-04-23T21:02:${String(15 + i).padStart(2, '0')}.000Z`,
    display_name: `User ${i}`,
  })),
  correctOption: 2,
  expected: Array.from({ length: 5 }, (_, i) => ({
    rank: i + 1,
    id: `user${i}`,
    display_name: `User ${i}`,
  })),
});

tests.push({
  name: 'Handle missing timestamp (sorts first)',
  presses: [
    { id: 'user1', choice: 2, display_name: 'no-timestamp' },
    { id: 'user2', choice: 2, timestamp: '2025-04-23T21:02:15.000Z', display_name: 'with-timestamp' },
  ],
  correctOption: 2,
  expected: [
    { rank: 1, id: 'user1', display_name: 'no-timestamp' },
    { rank: 2, id: 'user2', display_name: 'with-timestamp' },
  ],
});

tests.push({
  name: 'Anonymous users (no display_name)',
  presses: [
    { id: 'user1', choice: 2, timestamp: '2025-04-23T21:02:15.000Z' },
    { id: 'user2', choice: 2, timestamp: '2025-04-23T21:02:16.000Z' },
  ],
  correctOption: 2,
  expected: [
    { rank: 1, id: 'user1', display_name: 'Anonymous' },
    { rank: 2, id: 'user2', display_name: 'Anonymous' },
  ],
});

tests.push({
  name: 'Return empty when no correct option set',
  presses: [
    { id: 'user1', choice: 2, timestamp: '2025-04-23T21:02:15.000Z', display_name: 'user' },
  ],
  correctOption: null,
  expected: [],
});

tests.push({
  name: 'Handle empty presses array',
  presses: [],
  correctOption: 2,
  expected: [],
});

// Run tests
let passed = 0;
let failed = 0;

console.log('Running Cups Leaderboard Ranking Tests\n');
console.log('='.repeat(60));

tests.forEach((test, idx) => {
  const result = rankCupPresses(test.presses, test.correctOption);
  const isMatch = testPasses(result, test.expected, test.name);

  if (isMatch) {
    console.log(`✓ Test ${idx + 1}: ${test.name}`);
    passed++;
  } else {
    console.log(`✗ Test ${idx + 1}: ${test.name}`);
    console.log(`  Expected ${test.expected.length} results: ${JSON.stringify(test.expected.map(e => `${e.rank}:${e.id}`))}`);
    console.log(`  Got ${result.length} results: ${JSON.stringify(result.map(r => `${r.rank}:${r.id}`))}`);
    failed++;
  }
});

console.log('='.repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

process.exit(failed > 0 ? 1 : 0);
