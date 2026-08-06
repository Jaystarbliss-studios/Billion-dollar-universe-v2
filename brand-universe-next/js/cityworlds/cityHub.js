/**
 * City Hub Controller — Displays active/upcoming cities and leaderboard.
 */

export async function initCityHub() {
  // Get DOM elements early
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const activeCityDiv = document.getElementById('active-city');
  const activeName = document.getElementById('active-name');
  const activeMeta = document.getElementById('active-meta');
  const activeProgress = document.getElementById('active-progress');
  const activeStatus = document.getElementById('active-status');
  const enterActiveBtn = document.getElementById('enter-active');
  const upcomingList = document.getElementById('upcoming-list');
  const lbCityName = document.getElementById('lb-city-name');
  const leaderboardList = document.getElementById('leaderboard-list');

  const db = firebase.firestore();

  // Wait for Firebase Auth to be ready
  const user = await new Promise((resolve) => {
    const unsubscribe = firebase.auth().onAuthStateChanged((u) => {
      unsubscribe();
      resolve(u);
    });
    // If auth state is already available, the callback fires immediately.
  });

  if (!user) {
    // Show login message
    document.body.innerHTML = `
      <div style="display:flex;justify-content:center;align-items:center;height:100vh;color:white;background:#0a0a0a;font-family:sans-serif;">
        <div style="text-align:center;">
          <h2>Not Logged In</h2>
          <p>Please <a href="/" style="color:#C6A85E;">log in</a> to access City Worlds.</p>
        </div>
      </div>`;
    if (loading) loading.style.display = 'none';
    return;
  }

  try {
    const citiesSnap = await db.collection('cities').orderBy('createdAt', 'desc').get();
    const cities = citiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const active = cities.find(c => c.status === 'ACTIVE') || cities.find(c => c.status === 'FILLING');
    const upcoming = cities.filter(c => c.status === 'UPCOMING');

    if (active) {
      const filled = active.soldCount || 0;
      const total = active.parcelCount || 1;
      const percent = Math.round((filled / total) * 100);
      activeName.textContent = `${active.name}, ${active.country}`;
      activeMeta.textContent = `${filled} / ${total} parcels sold`;
      activeProgress.style.width = percent + '%';
      activeStatus.textContent = percent >= 100 ?
        '🏆 City is full! Visit the archive to see final standings.' :
        `${percent}% filled — claim your piece before it's full!`;
      activeCityDiv.style.display = 'block';
      enterActiveBtn.onclick = () => {
        window.location.href = `city-map.html?cityId=${active.id}`;
      };

      // Load leaderboard
      const lbSnap = await db.collection(`cities/${active.id}/leaderboard`)
        .orderBy('pointsTotal', 'desc')
        .limit(10)
        .get();
      lbCityName.textContent = active.name;
      leaderboardList.innerHTML = '';
      if (lbSnap.empty) {
        leaderboardList.innerHTML = '<div class="leaderboard-item">No entries yet.</div>';
      } else {
        lbSnap.forEach(doc => {
          const data = doc.data();
          const div = document.createElement('div');
          div.className = 'leaderboard-item';
          div.innerHTML = `<span>${data.brandName || 'Unknown'}</span><span>${data.pointsTotal || 0} pts</span>`;
          leaderboardList.appendChild(div);
        });
      }
    } else {
      activeCityDiv.style.display = 'none';
      document.querySelector('.leaderboard').style.display = 'none';
    }

    // Upcoming cities list
    upcoming.forEach(city => {
      const el = document.createElement('div');
      el.className = 'city-card';
      const date = city.releaseDate?.toDate ? city.releaseDate.toDate() : new Date(city.releaseDate);
      const dateStr = date ? date.toLocaleDateString() : 'TBD';
      el.innerHTML = `
        <h3 class="city-title">${city.name}, ${city.country}</h3>
        <div class="city-meta">Releases: ${dateStr}</div>
        <div class="city-meta">Expected parcels: ${city.parcelCount}</div>
        <p>Status: <em>${city.status}</em></p>
      `;
      upcomingList.appendChild(el);
    });

    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (err) {
    console.error('City Hub error:', err);
    if (loading) loading.textContent = 'Error loading cities: ' + err.message;
  }
}
