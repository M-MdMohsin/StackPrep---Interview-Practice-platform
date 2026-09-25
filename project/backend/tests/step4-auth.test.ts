import request from 'supertest';
import app from '../src/app';
import prisma from '../src/config/prisma';

async function runAuthTests() {
  console.log('--- Starting Step 4 Auth Integration Verification ---');

  const randomSuffix = Math.floor(Math.random() * 1000000);
  const userAEmail = `usera_${randomSuffix}@example.com`;
  const userBEmail = `userb_${randomSuffix}@example.com`;
  const password = 'Password123!';

  // Test 1: Protected route with no token -> 401
  console.log('1. Testing GET /api/me without token (expecting 401)...');
  const noTokenRes = await request(app).get('/api/me');
  if (noTokenRes.status !== 401) {
    throw new Error(`Expected 401, got ${noTokenRes.status}: ${JSON.stringify(noTokenRes.body)}`);
  }
  console.log('   ✓ Hitting protected route with no token returns 401 Unauthorized');

  // Test 2: Signup User A -> 201
  console.log('2. Testing POST /api/auth/signup for User A...');
  const signupResA = await request(app)
    .post('/api/auth/signup')
    .send({ email: userAEmail, password, name: 'User A' });

  if (signupResA.status !== 201 || !signupResA.body.accessToken || !signupResA.body.user) {
    throw new Error(`Signup failed for User A: ${JSON.stringify(signupResA.body)}`);
  }
  const userA = signupResA.body.user;
  const tokenA = signupResA.body.accessToken;
  console.log(`   ✓ User A signed up successfully (id: ${userA.id}, email: ${userA.email})`);

  // Test 3: Access /api/me with User A's token -> 200
  console.log('3. Testing GET /api/me with User A token (expecting 200)...');
  const meRes = await request(app)
    .get('/api/me')
    .set('Authorization', `Bearer ${tokenA}`);

  if (meRes.status !== 200 || meRes.body.user.id !== userA.id) {
    throw new Error(`GET /api/me failed: ${JSON.stringify(meRes.body)}`);
  }
  console.log('   ✓ GET /api/me returned authenticated user details');

  // Test 4: Login User A -> 200
  console.log('4. Testing POST /api/auth/login for User A...');
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: userAEmail, password });

  if (loginRes.status !== 200 || !loginRes.body.accessToken) {
    throw new Error(`Login failed for User A: ${JSON.stringify(loginRes.body)}`);
  }
  console.log('   ✓ Login succeeded and issued fresh JWT tokens');

  // Test 5: Signup User B -> 201
  console.log('5. Testing POST /api/auth/signup for User B...');
  const signupResB = await request(app)
    .post('/api/auth/signup')
    .send({ email: userBEmail, password, name: 'User B' });

  if (signupResB.status !== 201 || !signupResB.body.accessToken) {
    throw new Error(`Signup failed for User B: ${JSON.stringify(signupResB.body)}`);
  }
  const userB = signupResB.body.user;
  const tokenB = signupResB.body.accessToken;
  console.log(`   ✓ User B signed up successfully (id: ${userB.id})`);

  // Test 6: User A accessing User A's resource -> 200
  console.log('6. Testing User A accessing User A resource...');
  const ownRes = await request(app)
    .get(`/api/auth/users/${userA.id}`)
    .set('Authorization', `Bearer ${tokenA}`);

  if (ownRes.status !== 200) {
    throw new Error(`Expected 200 for owning resource, got ${ownRes.status}: ${JSON.stringify(ownRes.body)}`);
  }
  console.log('   ✓ User A successfully accessed own resource (200 OK)');

  // Test 7: User A accessing User B's resource -> 403 Forbidden
  console.log("7. Testing User A accessing User B resource (expecting 403 Forbidden)...");
  const crossUserRes = await request(app)
    .get(`/api/auth/users/${userB.id}`)
    .set('Authorization', `Bearer ${tokenA}`);

  if (crossUserRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden, got ${crossUserRes.status}: ${JSON.stringify(crossUserRes.body)}`);
  }
  console.log("   ✓ User A accessing User B resource returned 403 Forbidden (assertOwnsResource check passed)");

  // Test 8: Logout -> 200
  console.log('8. Testing POST /api/auth/logout...');
  const logoutRes = await request(app).post('/api/auth/logout');
  if (logoutRes.status !== 200) {
    throw new Error(`Logout failed: ${JSON.stringify(logoutRes.body)}`);
  }
  console.log('   ✓ Logout cleared cookies and returned 200');

  console.log('\n--- ALL STEP 4 AUTH TESTS PASSED SUCCESSFULLY! ---');
}

runAuthTests()
  .catch((err) => {
    console.error('Test failed with error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
