import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import './styles.css';

const pageTitles = {
  overview: ['Campus Academic Portal', 'A clear view of your academic records'],
  dashboard: ['Dashboard', 'Your academic workspace'],
  records: ['Academic records', 'Courses and grades linked to your account'],
  roster: ['Course workspace', 'Your assigned course and class roster'],
  note: ['Course notes', 'Your private notes for assigned and enrolled courses'],
  crypto: ['Protected academic note', 'A small demonstration of note protection'],
  signin: ['Sign in', 'Access your academic account'],
  enroll: ['Passkey registration', 'Set up secure access to your account'],
};

function Icon({ name, size = 20 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const drawings = {
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20M8 7h8M8 11h7"/></>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></>,
    records: <><path d="M7 3h8l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M15 3v5h5M9 12h7M9 16h7"/></>,
    course: <><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H12v18H5.5A2.5 2.5 0 0 0 3 23z"/><path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H12v18h6.5a2.5 2.5 0 0 1 2.5 2z"/><path d="M6 7h3M15 7h3"/></>,
    note: <><path d="M6 3h12a2 2 0 0 1 2 2v14l-4-2-4 2-4-2-4 2V5a2 2 0 0 1 2-2z"/><path d="M8 8h8M8 12h8"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    chevron: <><path d="m7 10 5 5 5-5"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></>,
  };
  return <svg {...common}>{drawings[name] || drawings.records}</svg>;
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function App() {
  const [page, setPage] = useState('overview');
  const [user, setUser] = useState(null);
  const [csrf, setCsrf] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [records, setRecords] = useState(null);
  const [courseCatalog, setCourseCatalog] = useState([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState(['IS451']);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [roster, setRoster] = useState(null);
  const [notePayload, setNotePayload] = useState(null);
  const [noteRecovered, setNoteRecovered] = useState('');
  const [tamperDetected, setTamperDetected] = useState(null);
  const [courseNotes, setCourseNotes] = useState([]);
  const [notesCourses, setNotesCourses] = useState([]);
  const [noteDraft, setNoteDraft] = useState({ courseId: '', title: '', body: '' });
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [demoAccountIds, setDemoAccountIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('campus.demoAccountIds') || '[]');
      return Array.isArray(saved) ? saved.filter(id => /^(?:D|L)-[A-F0-9]{8}$/.test(id)).slice(-100) : [];
    } catch {
      return [];
    }
  });
  const [userId, setUserId] = useState(() => demoAccountIds.at(-1) || '');
  const [code, setCode] = useState('');
  const [lecturerInviteCode, setLecturerInviteCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [courseDraft, setCourseDraft] = useState({ id: '', title: '' });
  const [edit, setEdit] = useState({ studentId: 'S1', assessment: 'Security lab', grade: '' });
  const [editingGrade, setEditingGrade] = useState(false);

  async function refreshCsrf() {
    const response = await fetch('/api/csrf', { credentials: 'include' });
    const data = await response.json();
    if (!response.ok) throw new Error('Could not prepare the account session.');
    setCsrf(data.csrfToken);
    return data.csrfToken;
  }

  async function api(path, options = {}) {
    const csrfToken = options.method && options.method !== 'GET'
      ? await refreshCsrf()
      : csrf;
    const response = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
        ...options.headers,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'We could not complete that request. Please try again.');
    return data;
  }

  async function loadSession() {
    try {
      const data = await api('/api/me');
      setUser(data.user);
      setPage(current => current === 'overview' ? 'dashboard' : current);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    refreshCsrf().then(loadSession).catch(() => setError('The portal could not connect to its local server. Start the app and refresh this page.'));
    api('/api/enrol/options').then(data => setCourseCatalog(data.courses || [])).catch(requestError => setError(requestError.message));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'student') {
      api('/api/records/me').then(setRecords).catch(requestError => setError(requestError.message));
      api('/api/course-notes').then(data => {
        setCourseNotes(data.notes || []);
        setNotesCourses(data.courses || []);
        setNoteDraft(draft => ({ ...draft, courseId: draft.courseId || data.courses?.[0]?.id || '' }));
      }).catch(requestError => setError(requestError.message));
    } else if (user.role === 'lecturer') {
      api('/api/lecturer/roster').then(setRoster).catch(requestError => setError(requestError.message));
      api('/api/course-notes').then(data => {
        setCourseNotes(data.notes || []);
        setNotesCourses(data.courses || []);
        setNoteDraft(draft => ({ ...draft, courseId: draft.courseId || data.courses?.[0]?.id || '' }));
      }).catch(requestError => setError(requestError.message));
    }
  }, [user]);

  function clearMessages() {
    setError('');
    setNotice('');
  }

  function rememberDemoAccount(id) {
    const nextIds = [...new Set([...demoAccountIds, id])].slice(-100);
    setDemoAccountIds(nextIds);
    try {
      localStorage.setItem('campus.demoAccountIds', JSON.stringify(nextIds));
    } catch {
      // The current page still remembers the account if browser storage is unavailable.
    }
  }

  async function enroll(event) {
    event.preventDefault();
    setBusy(true);
    clearMessages();
    try {
      const options = await api('/api/enrol/options', { method: 'POST', body: JSON.stringify({ userId, code }) });
      const credential = await startRegistration({ optionsJSON: options });
      await api('/api/enrol/verify', { method: 'POST', body: JSON.stringify(credential) });
      setCode('');
      setNotice(`Passkey registered for ${userId}. Enter that account ID on the sign-in page.`);
      setPage('signin');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createDemoAccount() {
    setBusy(true);
    clearMessages();
    try {
      const result = await api('/api/enrol/options', {
        method: 'POST',
        body: JSON.stringify({ createDemoAccount: true, displayName, courseIds: selectedCourseIds }),
      });
      rememberDemoAccount(result.demoAccount.userId);
      setUserId(result.demoAccount.userId);
      setCode(result.demoAccount.code);
      setNotice(`Student demo account ${result.demoAccount.userId} is ready. Register its passkey below.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createLecturerAccount() {
    setBusy(true);
    clearMessages();
    try {
      const result = await api('/api/enrol/options', {
        method: 'POST',
        body: JSON.stringify({ createLecturerAccount: true, displayName, inviteCode: lecturerInviteCode, courseId: selectedCourseId }),
      });
      rememberDemoAccount(result.lecturerAccount.userId);
      setUserId(result.lecturerAccount.userId);
      setCode(result.lecturerAccount.code);
      setLecturerInviteCode('');
      setNotice(`Lecturer account ${result.lecturerAccount.userId} is ready. Register its passkey below.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function enrollInCourse() {
    if (!selectedCourseId) return;
    clearMessages();
    try {
      await api('/api/enrol/options', { method: 'POST', body: JSON.stringify({ enrollCourse: true, courseId: selectedCourseId }) });
      setRecords(await api('/api/records/me'));
      setSelectedCourseId('');
      setNotice('You are enrolled in the selected course. Grades will appear when they are recorded.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createCourse(event) {
    event.preventDefault();
    clearMessages();
    try {
      const result = await api('/api/enrol/options', {
        method: 'POST',
        body: JSON.stringify({ createCourse: true, courseId: courseDraft.id, title: courseDraft.title }),
      });
      const catalog = await api('/api/enrol/options');
      setCourseCatalog(catalog.courses || []);
      setRoster({ course: result.course, students: [] });
      setCourseDraft({ id: '', title: '' });
      setNotice('Course created and added to your teaching assignments. Students can now enroll from their dashboard.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    clearMessages();
    try {
      const options = await api('/api/login/options', { method: 'POST', body: JSON.stringify({ userId }) });
      const assertion = await startAuthentication({ optionsJSON: options });
      await api('/api/login/verify', { method: 'POST', body: JSON.stringify(assertion) });
      await refreshCsrf();
      const session = await fetch('/api/me', { credentials: 'include' });
      if (!session.ok) throw new Error('Your account could not be loaded. Please sign in again.');
      const data = await session.json();
      setUser(data.user);
      setPage('dashboard');
      setNotice('You are signed in.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    clearMessages();
    try {
      await api('/api/logout', { method: 'POST' });
      setUser(null);
      setRecords(null);
      setRoster(null);
      setCourseNotes([]);
      setNotesCourses([]);
      setEditingNoteId(null);
      setNotePayload(null);
      setNoteRecovered('');
      setTamperDetected(null);
      setPage('overview');
      await refreshCsrf();
      setNotice('You have signed out.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function encryptNote(note) {
    clearMessages();
    setNotePayload(null);
    setNoteRecovered('');
    setTamperDetected(null);
    if (!note) {
      setError('Create or save a course note first, then choose it here to encrypt it.');
      return;
    }
    try {
      const payload = await api('/api/crypto/demo/encrypt', { method: 'POST', body: JSON.stringify({ title: note.title, body: note.body }) });
      setNotePayload(payload);
      setNotice('Your selected course note has been encrypted for the demonstration.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function decryptNote() {
    if (!notePayload) return;
    clearMessages();
    setNoteRecovered('');
    try {
      const result = await api('/api/crypto/demo/decrypt', { method: 'POST', body: JSON.stringify(notePayload) });
      setNoteRecovered(result.recovered);
      setNotice('The encrypted note was decrypted successfully.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function testNoteIntegrity() {
    if (!notePayload) return;
    clearMessages();
    setTamperDetected(null);
    try {
      const result = await api('/api/crypto/demo/tamper', { method: 'POST', body: JSON.stringify(notePayload) });
      setTamperDetected(result.tamperDetected);
      setNotice(result.tamperDetected ? 'The altered note was rejected.' : 'The altered note was unexpectedly accepted.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function saveCourseNote(event) {
    event.preventDefault();
    clearMessages();
    try {
      if (editingNoteId) {
        await api(`/api/course-notes/${editingNoteId}`, { method: 'PUT', body: JSON.stringify({ title: noteDraft.title, body: noteDraft.body }) });
        setNotice('Your course note was updated.');
      } else {
        await api('/api/course-notes', { method: 'POST', body: JSON.stringify(noteDraft) });
        setNotice('Your note was saved to the selected course.');
      }
      const data = await api('/api/course-notes');
      setCourseNotes(data.notes || []);
      setNotesCourses(data.courses || []);
      setNoteDraft({ courseId: data.courses?.[0]?.id || '', title: '', body: '' });
      setEditingNoteId(null);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deleteCourseNote(noteId) {
    clearMessages();
    try {
      await api(`/api/course-notes/${noteId}`, { method: 'DELETE' });
      const data = await api('/api/course-notes');
      setCourseNotes(data.notes || []);
      if (editingNoteId === noteId) {
        setEditingNoteId(null);
        setNoteDraft({ courseId: data.courses?.[0]?.id || '', title: '', body: '' });
      }
      setNotice('Your note was deleted.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function saveGrade(event) {
    event.preventDefault();
    clearMessages();
    try {
      await api('/api/grades', {
        method: 'PUT',
        body: JSON.stringify({ ...edit, studentId: roster.students.some(student => student.id === edit.studentId) ? edit.studentId : roster.students[0]?.id, courseId: roster.course.id, grade: Number(edit.grade) }),
      });
      setNotice(editingGrade ? 'Grade record updated.' : 'Grade saved successfully.');
      setEditingGrade(false);
      setRoster(await api('/api/lecturer/roster'));
      setEdit({ studentId: roster.students[0]?.id || '', assessment: '', grade: '' });
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function beginEditGrade(student) {
    setEdit({ studentId: student.id, assessment: student.assessment, grade: String(student.grade) });
    setEditingGrade(true);
    setError('');
    setNotice(`Editing ${student.assessment} for ${student.name}.`);
  }

  async function deleteGradeRecord(student) {
    if (!window.confirm(`Delete the ${student.assessment} record for ${student.name}?`)) return;
    clearMessages();
    try {
      await api('/api/grades', {
        method: 'DELETE',
        body: JSON.stringify({ studentId: student.id, courseId: roster.course.id, assessment: student.assessment }),
      });
      if (editingGrade && edit.studentId === student.id && edit.assessment === student.assessment) setEditingGrade(false);
      setRoster(await api('/api/lecturer/roster'));
      setNotice('Assessment record deleted.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function navigate(nextPage) {
    setPage(nextPage);
    setMobileNavOpen(false);
    clearMessages();
  }

  const isStudent = user?.role === 'student';
  const navItems = user
    ? [
        ['dashboard', 'Dashboard', 'home'],
        ...(isStudent ? [['records', 'Academic records', 'records']] : [['roster', 'Course workspace', 'course']]),
        ['note', 'Course notes', 'note'],
        ['crypto', 'Encryption demo', 'lock'],
      ]
    : [
        ['overview', 'Portal overview', 'home'],
        ['signin', 'Sign in', 'user'],
        ['enroll', 'Register passkey', 'records'],
      ];
  const title = page === 'note' && isStudent ? ['Course notes', 'Create and manage your notes by course'] : pageTitles[page] || pageTitles.overview;

  return (
    <div className="portal-shell">
      {mobileNavOpen && <button className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <button className="brand" onClick={() => navigate(user ? 'dashboard' : 'overview')} aria-label="Campus Academic Portal home">
          <span className="brand-icon"><Icon name="book" size={23} /></span>
          <span className="brand-name">Campus<span>Academic Portal</span></span>
        </button>
        <div className="sidebar-caption">ACADEMIC SERVICES</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(([key, label, icon]) => (
            <button key={key} className={`side-link ${page === key ? 'side-link-active' : ''}`} aria-current={page === key ? 'page' : undefined} onClick={() => navigate(key)}>
              <Icon name={icon} size={19} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-rule" />
          {user ? (
            <div className="sidebar-user"><span className="avatar">{initials(user.displayName)}</span><span><b>{user.displayName}</b><small>{user.id} - {user.role}</small></span></div>
          ) : (
            <div className="sidebar-help"><span className="help-icon"><Icon name="user" size={17} /></span><span><b>Student and lecturer access</b><small>Use your assigned portal account</small></span></div>
          )}
          {user && <button className="signout-link" onClick={logout}><Icon name="logout" size={18} />Sign out</button>}
          <p className="sidebar-footnote">Campus Academic Portal<br />IS451 classroom prototype</p>
        </div>
      </aside>

      <div className="portal-main">
        <header className="page-header">
          <button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
          <div className="header-title"><h1>{title[0]}</h1><p>{title[1]}</p></div>
          {user ? (
            <div className="header-profile"><span className="avatar avatar-small">{initials(user.displayName)}</span><span><b>{user.displayName}</b><small>{user.role === 'student' ? 'Student account' : 'Lecturer account'}</small></span></div>
          ) : (
            <button className="button button-primary header-action" onClick={() => navigate('signin')}>Sign in <Icon name="arrow" size={16} /></button>
          )}
        </header>

        <main className="page-content">
          {notice && <div className="alert alert-success" role="status"><span className="alert-icon"><Icon name="check" size={16} /></span><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss message"><Icon name="close" size={15} /></button></div>}
          {error && <div className="alert alert-error" role="alert"><span className="alert-icon">!</span><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" size={15} /></button></div>}

          {page === 'overview' && <Overview onSignIn={() => navigate('signin')} onRegister={() => navigate('enroll')} />}
          {page === 'signin' && <SignInForm userId={userId} setUserId={setUserId} demoAccountIds={demoAccountIds} busy={busy} onSubmit={signIn} onRegister={() => navigate('enroll')} />}
          {page === 'enroll' && <EnrollmentForm userId={userId} setUserId={setUserId} demoAccountIds={demoAccountIds} code={code} setCode={setCode} displayName={displayName} setDisplayName={setDisplayName} busy={busy} onCreateDemo={createDemoAccount} lecturerInviteCode={lecturerInviteCode} setLecturerInviteCode={setLecturerInviteCode} onCreateLecturer={createLecturerAccount} selectedCourseId={selectedCourseId} setSelectedCourseId={setSelectedCourseId} onSubmit={enroll} onSignIn={() => navigate('signin')} courses={courseCatalog} selectedCourseIds={selectedCourseIds} setSelectedCourseIds={setSelectedCourseIds} />}
          {page === 'dashboard' && <Dashboard user={user} records={records} roster={roster} edit={edit} setEdit={setEdit} editingGrade={editingGrade} setEditingGrade={setEditingGrade} onEditGrade={beginEditGrade} onDeleteGrade={deleteGradeRecord} onSave={saveGrade} onOpenRecords={() => navigate(isStudent ? 'records' : 'roster')} onSignIn={() => navigate('signin')} courses={courseCatalog} selectedCourseId={selectedCourseId} setSelectedCourseId={setSelectedCourseId} onEnrollCourse={enrollInCourse} onCreateCourse={createCourse} courseDraft={courseDraft} setCourseDraft={setCourseDraft} />}
          {page === 'records' && <StudentRecords user={user} records={records} onSignIn={() => navigate('signin')} />}
          {page === 'roster' && <LecturerWorkspace user={user} roster={roster} edit={edit} setEdit={setEdit} editingGrade={editingGrade} setEditingGrade={setEditingGrade} onEditGrade={beginEditGrade} onDeleteGrade={deleteGradeRecord} onSave={saveGrade} onSignIn={() => navigate('signin')} onCreateCourse={createCourse} courseDraft={courseDraft} setCourseDraft={setCourseDraft} />}
          {page === 'note' && <CourseNotesWorkspace user={user} courses={notesCourses} notes={courseNotes} draft={noteDraft} setDraft={setNoteDraft} editingNoteId={editingNoteId} setEditingNoteId={setEditingNoteId} onSave={saveCourseNote} onDelete={deleteCourseNote} onSignIn={() => navigate('signin')} />}
          {page === 'crypto' && <ProtectedNote user={user} notes={courseNotes} payload={notePayload} recovered={noteRecovered} tamperDetected={tamperDetected} onEncrypt={encryptNote} onDecrypt={decryptNote} onTestIntegrity={testNoteIntegrity} onSignIn={() => navigate('signin')} onGoToNotes={() => navigate('note')} />}
        </main>

        <footer className="page-footer"><span>Campus Academic Portal</span><span>Fictional academic records for classroom use</span></footer>
      </div>
    </div>
  );
}

function Overview({ onSignIn, onRegister }) {
  return (
    <section className="overview-page">
      <div className="welcome-panel">
        <div className="welcome-copy">
          <span className="eyebrow">YOUR ACADEMIC ACCOUNT</span>
          <h2>Welcome to <span>Campus Academic Portal</span></h2>
          <p>View your courses and grades, or manage results for your assigned course. Sign in with the passkey connected to your account.</p>
          <div className="welcome-actions"><button className="button button-primary" onClick={onSignIn}>Sign in to your account <Icon name="arrow" size={17} /></button><button className="button button-secondary" onClick={onRegister}>Register a passkey</button></div>
        </div>
        <div className="academic-illustration" aria-hidden="true">
          <div className="illustration-top"><span className="illustration-symbol"><Icon name="course" size={21} /></span><span>ACADEMIC OVERVIEW</span></div>
          <div className="illustration-title">Your studies,<br />in one place.</div>
          <div className="illustration-rule" />
          <div className="illustration-row"><span className="illustration-dot blue-dot" /><span>Course information</span><span className="illustration-line" /></div>
          <div className="illustration-row"><span className="illustration-dot purple-dot" /><span>Academic records</span><span className="illustration-line short-line" /></div>
          <div className="illustration-row"><span className="illustration-dot pale-dot" /><span>Passkey account access</span><span className="illustration-line medium-line" /></div>
          <div className="illustration-decoration decoration-one" /><div className="illustration-decoration decoration-two" />
        </div>
      </div>
      <div className="overview-section-heading"><div><span className="eyebrow">PORTAL SERVICES</span><h3>Everything you need for your academic records</h3></div></div>
      <div className="service-grid">
        <article className="service-card"><span className="service-icon blue-surface"><Icon name="records" size={21} /></span><div><h4>Academic records</h4><p>Review your profile, enrolled courses and grades in one clear view.</p></div></article>
        <article className="service-card"><span className="service-icon purple-surface"><Icon name="course" size={21} /></span><div><h4>Course workspace</h4><p>Lecturers can review the roster and update grades for their assigned course.</p></div></article>
        <article className="service-card"><span className="service-icon pale-surface"><Icon name="user" size={21} /></span><div><h4>Passkey sign-in</h4><p>Use the account passkey supported by your browser or device.</p></div></article>
      </div>
      <p className="prototype-note">This classroom portal uses fictional student and course information.</p>
    </section>
  );
}

function SignInForm({ userId, setUserId, demoAccountIds, busy, onSubmit, onRegister }) {
  return (
    <section className="auth-page">
      <div className="auth-intro"><span className="eyebrow">CAMPUS ACADEMIC PORTAL</span><h2>Sign in to your<br /><span>academic account</span></h2><p>Use the passkey registered to your university demo account. Your browser or device will ask you to confirm.</p><div className="auth-support"><Icon name="book" size={20} /><span>Secure access to your academic records</span></div></div>
      <form className="form-card" onSubmit={onSubmit}>
        <div className="form-card-heading"><span className="eyebrow">ACCOUNT ACCESS</span><h3>Welcome back</h3><p>Choose your account to continue with your passkey.</p></div>
        <label htmlFor="signin-account">Academic account</label>
        <input id="signin-account" type="text" list="known-signin-accounts" value={userId} onChange={event => setUserId(event.target.value.toUpperCase())} autoComplete="off" required placeholder="Enter your account ID" />
        <datalist id="known-signin-accounts">{demoAccountIds.map(id => <option value={id} key={id}>{id} - Your demo {id.startsWith('L-') ? 'lecturer' : 'student'} account</option>)}</datalist>
        <button className="button button-primary button-block" disabled={busy}>{busy ? 'Waiting for your device...' : 'Continue with passkey'} <Icon name="arrow" size={17} /></button>
        <p className="form-help">Your passkey stays with your device. No password is needed.</p>
        <div className="form-divider"><span>New to passkey access?</span></div>
        <button className="text-action" type="button" onClick={onRegister}>Register your passkey <Icon name="arrow" size={15} /></button>
      </form>
    </section>
  );
}

function EnrollmentForm({ userId, setUserId, demoAccountIds, code, setCode, displayName, setDisplayName, busy, onCreateDemo, lecturerInviteCode, setLecturerInviteCode, onCreateLecturer, selectedCourseId, setSelectedCourseId, onSubmit, onSignIn, courses, selectedCourseIds, setSelectedCourseIds }) {
  return (
    <section className="auth-page">
      <div className="auth-intro"><span className="eyebrow">ACCOUNT SETUP</span><h2>Register your<br /><span>passkey</span></h2><p>Connect a passkey to your assigned classroom account. Your browser or device will guide you through a short confirmation.</p><div className="auth-support"><Icon name="user" size={20} /><span>Use only the account and one-time code issued to you.</span></div></div>
      <form className="form-card" onSubmit={onSubmit}>
        <div className="form-card-heading"><span className="eyebrow">PASSKEY REGISTRATION</span><h3>Set up account access</h3><p>Use an issued code or create a fictional student demo account.</p></div>
        <label htmlFor="demo-name">Your display name</label>
        <input id="demo-name" value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={60} autoComplete="name" placeholder="Your display name" />
        <fieldset className="course-choice-list"><legend>Choose your courses</legend>{courses.map(course => <label className="course-choice" key={course.id}><input type="checkbox" checked={selectedCourseIds.includes(course.id)} onChange={event => setSelectedCourseIds(current => event.target.checked ? [...current, course.id] : current.filter(id => id !== course.id))} /><span><b>{course.id}</b> — {course.title}</span></label>)}</fieldset>
        <button className="button button-secondary button-block" type="button" onClick={onCreateDemo} disabled={busy || displayName.trim().length < 2 || selectedCourseIds.length === 0}>{busy ? 'Preparing account...' : 'Create my student account'}</button>
        <p className="form-help">This creates your own fictional student account and enrolls it in the selected courses. Public signups cannot receive lecturer access.</p>
        <div className="form-divider"><span>Lecturer account</span></div>
        <p className="form-help lecturer-invite-help">Lecturer access requires a single-use invitation code from the portal administrator.</p>
        <label htmlFor="lecturer-invite">One-time lecturer invitation code</label>
        <input id="lecturer-invite" type="password" value={lecturerInviteCode} onChange={event => setLecturerInviteCode(event.target.value)} autoComplete="off" placeholder="Enter your lecturer invitation" />
        <label htmlFor="lecturer-course">Assigned course</label>
        <select id="lecturer-course" value={selectedCourseId} onChange={event => setSelectedCourseId(event.target.value)}><option value="">Choose the course you will teach</option>{courses.map(course => <option key={course.id} value={course.id}>{course.id} - {course.title}</option>)}</select>
        <button className="button button-secondary button-block" type="button" onClick={onCreateLecturer} disabled={busy || displayName.trim().length < 2 || lecturerInviteCode.trim().length < 20 || !selectedCourseId}>{busy ? 'Preparing account...' : 'Create lecturer account'}</button>
        <div className="form-divider"><span>Or use an issued code</span></div>
        <label htmlFor="enroll-account">Academic account</label>
        <input id="enroll-account" type="text" list="known-enrollment-accounts" value={userId} onChange={event => setUserId(event.target.value.toUpperCase())} autoComplete="off" required placeholder="Enter your issued account ID" />
        <datalist id="known-enrollment-accounts">{demoAccountIds.map(id => <option value={id} key={id}>{id} - Your demo {id.startsWith('L-') ? 'lecturer' : 'student'} account</option>)}</datalist>
        <label htmlFor="enroll-code">One-time registration code</label>
        <input id="enroll-code" type="password" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" required minLength={12} placeholder="Enter your issued code" />
        <button className="button button-primary button-block" disabled={busy}>{busy ? 'Waiting for your device...' : 'Register passkey'} <Icon name="arrow" size={17} /></button>
        <p className="form-help">Codes expire after 48 hours and can be used once. Demo signups are limited to 100 student accounts.</p>
        <div className="form-divider"><span>Already registered?</span></div>
        <button className="text-action" type="button" onClick={onSignIn}>Sign in to your account <Icon name="arrow" size={15} /></button>
      </form>
    </section>
  );
}

function Dashboard({ user, records, roster, edit, setEdit, editingGrade, setEditingGrade, onEditGrade, onDeleteGrade, onSave, onOpenRecords, onSignIn, courses: courseCatalog, selectedCourseId, setSelectedCourseId, onEnrollCourse, onCreateCourse, courseDraft, setCourseDraft }) {
  if (!user) return <SignedOutState title="Sign in to view your dashboard" onSignIn={onSignIn} />;
  if (user.role === 'lecturer') return <LecturerWorkspace user={user} roster={roster} edit={edit} setEdit={setEdit} editingGrade={editingGrade} setEditingGrade={setEditingGrade} onEditGrade={onEditGrade} onDeleteGrade={onDeleteGrade} onSave={onSave} onSignIn={onSignIn} onCreateCourse={onCreateCourse} courseDraft={courseDraft} setCourseDraft={setCourseDraft} />;
  if (!records) return <LoadingState label="Loading your academic information..." />;
  const enrolledCourses = records.courses || [...new Set(records.grades.map(grade => grade.course))];
  const availableCourses = courseCatalog.filter(course => !enrolledCourses.includes(course.title));
  return (
    <section className="dashboard-page">
      <div className="welcome-heading"><div><span className="eyebrow">STUDENT DASHBOARD</span><h2>Welcome, <span>{user.displayName.split(' ')[0]}</span></h2><p>Your academic information is ready to view.</p></div><div className="student-id-card"><span className="avatar avatar-large">{initials(user.displayName)}</span><span><b>{records.profile.name}</b><small>Student ID: {records.profile.id}</small></span></div></div>
      <div className="section-header"><div><span className="eyebrow">YOUR STUDIES</span><h3>Enrolled courses</h3></div><button className="text-action" onClick={onOpenRecords}>View academic records <Icon name="arrow" size={15} /></button></div>
      {enrolledCourses.length ? <div className="course-grid">{enrolledCourses.map(course => <article className="course-card" key={course}><span className="course-card-icon"><Icon name="course" size={20} /></span><div><span className="eyebrow">ENROLLED COURSE</span><h4>{course}</h4><p>Course information and assessment results</p></div><button className="icon-button" onClick={onOpenRecords} aria-label={`View records for ${course}`}><Icon name="arrow" size={17} /></button></article>)}</div> : <EmptyState title="No courses are listed yet" description="Your enrolled courses will appear here when they are available." />}
      {availableCourses.length > 0 && <div className="course-enroll-panel"><div><span className="eyebrow">COURSE CATALOG</span><h3>Explore more courses</h3><p>Enroll in a course to add it to your academic profile.</p></div><div className="course-enroll-controls"><label htmlFor="course-catalog">Choose a course</label><select id="course-catalog" value={selectedCourseId} onChange={event => setSelectedCourseId(event.target.value)}><option value="">Select a course</option>{availableCourses.map(course => <option key={course.id} value={course.id}>{course.id} - {course.title}</option>)}</select><button className="button button-primary" type="button" disabled={!selectedCourseId} onClick={onEnrollCourse}>Enroll</button></div></div>}
      <div className="records-callout"><div><span className="eyebrow">ACADEMIC RECORDS</span><h3>Your grades and assessments</h3><p>Open your records to view assessment results for your courses.</p></div><button className="button button-primary" onClick={onOpenRecords}>View records <Icon name="arrow" size={16} /></button></div>
    </section>
  );
}

function StudentRecords({ user, records, onSignIn }) {
  if (!user) return <SignedOutState title="Sign in to view academic records" onSignIn={onSignIn} />;
  if (user.role !== 'student') return <EmptyState title="This page is for student records" description="Open your course workspace to manage your assigned roster." />;
  if (!records) return <LoadingState label="Loading your academic records..." />;
  return (
    <section className="records-page">
      <div className="records-profile"><span className="avatar avatar-large">{initials(records.profile.name)}</span><div><span className="eyebrow">STUDENT PROFILE</span><h2>{records.profile.name}</h2><p>Student ID: {records.profile.id}</p></div></div>
      <div className="section-header"><div><span className="eyebrow">ACADEMIC HISTORY</span><h3>Courses and grades</h3></div></div>
      {records.grades.length ? <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Course</th><th>Assessment</th><th>Grade</th></tr></thead><tbody>{records.grades.map((grade, index) => <tr key={`${grade.course}-${grade.assessment}-${index}`}><td><b>{grade.course}</b></td><td>{grade.assessment}</td><td><span className="grade-value">{grade.grade}</span><span className="grade-out-of"> / 100</span></td></tr>)}</tbody></table></div><div className="table-footnote">These records belong to your student account.</div></div> : <EmptyState title="No grades are available yet" description="Assessment results will appear here when your lecturer records them." />}
    </section>
  );
}

function LecturerWorkspace({ user, roster, edit, setEdit, editingGrade, setEditingGrade, onEditGrade, onDeleteGrade, onSave, onSignIn, onOpen, onCreateCourse, courseDraft, setCourseDraft, compact = false }) {
  if (!user) return <SignedOutState title="Sign in to open your course workspace" onSignIn={onSignIn} />;
  if (user.role !== 'lecturer') return <EmptyState title="Course workspace unavailable" description="This account does not have lecturer access." />;
  if (!roster) return <LoadingState label="Loading your assigned course..." />;
  const title = roster.course?.title;
  return (
    <section className="lecturer-page">
      {title && <div className="course-heading"><div><span className="eyebrow">ASSIGNED COURSE</span><h2>{title}</h2><p>Review enrolled students and update assessment grades.</p></div><span className="course-code">{roster.course.id}</span></div>}
      <form className="course-create-form" onSubmit={onCreateCourse}><div><span className="eyebrow">COURSE MANAGEMENT</span><h3>Create a course</h3><p>New courses appear in the student course catalog.</p></div><label htmlFor="new-course-id">Course code</label><input id="new-course-id" value={courseDraft.id} onChange={event => setCourseDraft({ ...courseDraft, id: event.target.value.toUpperCase() })} placeholder="CS310" maxLength={9} pattern="[A-Za-z]{2,5}[0-9]{2,4}" required /><label htmlFor="new-course-title">Course title</label><input id="new-course-title" value={courseDraft.title} onChange={event => setCourseDraft({ ...courseDraft, title: event.target.value })} placeholder="Database Systems" maxLength={100} required /><button className="button button-primary" type="submit">Create course</button></form>
      {!title ? <EmptyState title="No assigned course is available yet" description="You can create a course above; it will become your first teaching assignment." /> : <div className={`lecturer-layout ${compact ? 'lecturer-compact' : ''}`}>
        {compact && <div className="section-header"><div><span className="eyebrow">CLASS ROSTER</span><h3>Enrolled students</h3></div>{onOpen && <button className="text-action" onClick={onOpen}>Course workspace <Icon name="arrow" size={15} /></button>}</div>}
        <div className="table-card roster-card"><div className="table-card-heading"><div><span className="eyebrow">CLASS ROSTER</span><h3>Enrolled students</h3></div></div>
          {roster.students.length ? <div className="table-scroll"><table><thead><tr><th>Student</th><th>Assessment</th><th>Grade</th><th>Manage</th></tr></thead><tbody>{roster.students.map((student, index) => <tr key={`${student.id}-${student.assessment}-${index}`}><td><span className="student-cell"><span className="avatar avatar-tiny">{initials(student.name)}</span><span><b>{student.name}</b><small>{student.id}</small></span></span></td><td>{student.assessment || 'No grade recorded'}</td><td>{student.grade === null ? <span className="grade-empty">Not recorded</span> : <><span className="grade-value">{student.grade}</span><span className="grade-out-of"> / 100</span></>}</td><td>{student.assessment ? <div className="record-actions"><button type="button" className="text-action" onClick={() => onEditGrade(student)}>Edit</button><button type="button" className="text-action record-delete" onClick={() => onDeleteGrade(student)}>Delete</button></div> : <span className="grade-empty">—</span>}</td></tr>)}</tbody></table></div> : <EmptyState title="No students are enrolled" description="Enrolled students will appear here." />}
          <div className="table-footnote">This roster is limited to your assigned course.</div>
        </div>
        {!compact && <form className="grade-form" onSubmit={onSave}>
          <span className="eyebrow">ASSESSMENT MANAGEMENT</span><h3>{editingGrade ? 'Edit a grade record' : 'Add or update a grade'}</h3><p>{editingGrade ? 'Update the selected student assessment.' : 'Choose a student and assessment. Saving the same assessment updates its existing record.'}</p>
          <label htmlFor="grade-student">Student</label><select id="grade-student" value={roster.students.some(student => student.id === edit.studentId) ? edit.studentId : roster.students[0]?.id || ''} onChange={event => setEdit({ ...edit, studentId: event.target.value })} required disabled={!roster.students.length}>{[...new Map(roster.students.map(student => [student.id, student])).values()].map(student => <option key={student.id} value={student.id}>{student.id} - {student.name}</option>)}</select>
          <label htmlFor="grade-assessment">Assessment</label><input id="grade-assessment" value={edit.assessment} onChange={event => setEdit({ ...edit, assessment: event.target.value })} required maxLength={60} />
          <label htmlFor="grade-score">Grade <span className="label-hint">0 to 100</span></label><input id="grade-score" type="number" min="0" max="100" step="1" value={edit.grade} onChange={event => setEdit({ ...edit, grade: event.target.value })} required />
          <button className="button button-primary button-block">{editingGrade ? 'Save changes' : 'Save grade'} <Icon name="arrow" size={16} /></button>
          {editingGrade && <button className="text-action grade-cancel" type="button" onClick={() => { setEditingGrade(false); setEdit({ studentId: roster.students[0]?.id || '', assessment: '', grade: '' }); }}>Cancel editing</button>}
          <p className="form-help">Only this assigned course can be updated.</p>
        </form>}
      </div>}
    </section>
  );
}

function CourseNotesWorkspace({ user, courses, notes, draft, setDraft, editingNoteId, setEditingNoteId, onSave, onDelete, onSignIn }) {
  if (!user) return <SignedOutState title="Sign in to manage your course notes" onSignIn={onSignIn} />;
  if (!['student', 'lecturer'].includes(user.role)) return <EmptyState title="Course notes are unavailable" description="Sign in with a student or lecturer account to continue." />;
  const scope = user.role === 'student' ? 'courses you are enrolled in' : 'courses assigned to you';
  return (
    <section className="note-page">
      <div className="note-intro"><span className="eyebrow">{user.role === 'student' ? 'YOUR STUDY NOTES' : 'YOUR TEACHING NOTES'}</span><h2>Course notes</h2><p>Create private notes for {scope}. Only your account can view, edit, or delete your notes.</p></div>
      <div className="course-notes-layout">
        <form className="course-note-editor" onSubmit={onSave}>
          <span className="eyebrow">{editingNoteId ? 'EDIT NOTE' : 'NEW NOTE'}</span>
          <h3>{editingNoteId ? 'Update your note' : 'Add a course note'}</h3>
          <label htmlFor="note-course">Course</label>
          <select id="note-course" value={draft.courseId} onChange={event => setDraft({ ...draft, courseId: event.target.value })} required disabled={Boolean(editingNoteId) || !courses.length}>
            <option value="">Choose a course</option>{courses.map(course => <option key={course.id} value={course.id}>{course.id} - {course.title}</option>)}
          </select>
          <label htmlFor="note-title">Title</label>
          <input id="note-title" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={100} placeholder="Lecture 1 — Introduction" required />
          <label htmlFor="note-body">Note</label>
          <textarea id="note-body" value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} maxLength={10000} rows={9} placeholder="Write your study notes here..." required />
          <div className="note-editor-footer"><span>{draft.body.length}/10,000</span><button className="button button-primary" type="submit" disabled={!courses.length}>{editingNoteId ? 'Save changes' : 'Save note'}</button></div>
          {editingNoteId && <button className="text-action note-cancel" type="button" onClick={() => { setEditingNoteId(null); setDraft({ courseId: courses[0]?.id || '', title: '', body: '' }); }}>Cancel editing</button>}
          {!courses.length && <p className="form-help">Enroll in a course before adding notes.</p>}
          <p className="form-help">Notes are encrypted in storage and decrypted for your account. Avoid passwords or highly sensitive personal information.</p>
        </form>
        <div className="course-note-list"><div className="section-header"><div><span className="eyebrow">SAVED NOTES</span><h3>Your notes</h3></div><span className="note-count">{notes.length}</span></div>
          {notes.length ? notes.map(note => <article className="course-note-card" key={note.id}>
            <div className="course-note-meta"><span className="course-code">{note.courseId}</span><time dateTime={new Date(Number(note.updatedAt)).toISOString()}>Updated {new Date(Number(note.updatedAt)).toLocaleString()}</time></div>
            <h4>{note.title}</h4><p className="course-note-course">{note.courseTitle}</p><p className="course-note-body">{note.body}</p>
            <div className="course-note-actions"><button className="text-action" type="button" onClick={() => { setEditingNoteId(note.id); setDraft({ courseId: note.courseId, title: note.title, body: note.body }); }}>Edit</button><button className="text-action note-delete" type="button" onClick={() => onDelete(note.id)}>Delete</button></div>
          </article>) : <div className="note-empty note-list-empty"><span className="note-empty-icon"><Icon name="note" size={22} /></span><b>No course notes yet</b><span>Choose an available course and save your first note.</span></div>}
        </div>
      </div>
    </section>
  );
}

function ProtectedNote({ user, notes, payload, recovered, tamperDetected, onEncrypt, onDecrypt, onTestIntegrity, onSignIn, onGoToNotes }) {
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const selectedNote = notes.find(note => String(note.id) === selectedNoteId) || notes[0];
  useEffect(() => {
    if (!notes.some(note => String(note.id) === selectedNoteId)) setSelectedNoteId(notes[0] ? String(notes[0].id) : '');
  }, [notes, selectedNoteId]);
  if (!user) return <SignedOutState title="Sign in to open the protected note" onSignIn={onSignIn} />;
  return (
    <section className="note-page">
      <div className="note-intro"><span className="eyebrow">ACADEMIC NOTE PROTECTION</span><h2>Encrypt one of your notes</h2><p>Select a saved course note. The demo encrypts its actual title and text, then lets you decrypt it and test whether tampering is detected. Your saved note itself is already encrypted at rest.</p></div>
      <div className="note-layout">
        <article className="note-card"><span className="eyebrow">YOUR SAVED NOTE</span>
          {notes.length ? <><label htmlFor="demo-note-select">Choose a course note</label><select id="demo-note-select" value={String(selectedNote?.id || '')} onChange={event => setSelectedNoteId(event.target.value)}>{notes.map(note => <option key={note.id} value={note.id}>{note.courseId} · {note.title}</option>)}</select><div className="sample-note"><span className="note-icon"><Icon name="note" size={20} /></span><div><b>{selectedNote.title}</b><p>{selectedNote.body}</p></div></div><button className="button button-primary" onClick={() => onEncrypt(selectedNote)}>Encrypt this note <Icon name="arrow" size={16} /></button></> : <><div className="note-empty"><b>No saved course notes</b><span>Create a note first, then return here to encrypt it.</span></div><button className="button button-primary" onClick={onGoToNotes}>Go to course notes <Icon name="arrow" size={16} /></button></>}
        </article>
        <article className="note-card note-output"><div className="note-card-title"><div><span className="eyebrow">ENCRYPTED DATA</span><h3>Encrypted note details</h3></div>{payload && <span className="status-badge">Encrypted</span>}</div>
          {payload ? <><div className="data-field"><span>Ciphertext</span><code>{payload.ciphertext}</code></div><div className="data-field"><span>Nonce</span><code>{payload.iv}</code></div><div className="data-field"><span>Authentication tag</span><code>{payload.tag}</code></div><div className="note-actions"><button className="button button-primary" onClick={onDecrypt}>Decrypt note</button><button className="button button-secondary" onClick={onTestIntegrity}>Test integrity protection</button></div>
            {recovered && <div className="result-box result-success" role="status"><b>Decryption succeeded</b><span>{recovered}</span></div>}
            {tamperDetected !== null && <div className={`result-box ${tamperDetected ? 'result-success' : 'result-error'}`} role="status"><b>{tamperDetected ? 'Modified data rejected' : 'Integrity check failed'}</b><span>{tamperDetected ? 'The altered ciphertext could not be authenticated.' : 'The modified ciphertext was not rejected.'}</span></div>}
          </> : <div className="note-empty"><span className="note-empty-icon"><Icon name="records" size={22} /></span><b>No encrypted note yet</b><span>Choose Encrypt note to create a sample.</span></div>}
        </article>
      </div>
      <details className="note-explanation"><summary>How note protection works</summary><p>A fresh 96-bit nonce is generated for each encryption. AES-GCM uses an authentication tag to detect changes to the ciphertext. This demo creates an encrypted copy of your selected note; it does not change the saved note or encrypt grades.</p></details>
    </section>
  );
}

function SignedOutState({ title, onSignIn }) {
  return <EmptyState title={title} description="Sign in to continue to your academic account." action={<button className="button button-primary" onClick={onSignIn}>Sign in <Icon name="arrow" size={16} /></button>} />;
}

function LoadingState({ label }) {
  return <div className="loading-state" role="status"><span className="loading-dot" />{label}</div>;
}

function EmptyState({ title, description, action }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon name="records" size={22} /></span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
