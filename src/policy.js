export function canReadStudent({ role, userId, targetId, assignedToLecturer }) {
  if (role === 'student') return userId === targetId;
  if (role === 'lecturer') return assignedToLecturer === true;
  return false;
}

export function canEditGrade({ role, assignedToLecturer, studentEnrolled }) {
  return role === 'lecturer' && assignedToLecturer === true && studentEnrolled === true;
}

export function isValidGradeChange({ studentId, courseId, assessment, grade }) {
  return /^(?:S[12]|D-[A-F0-9]{8})$/.test(String(studentId)) && typeof courseId === 'string' &&
    typeof assessment === 'string' && assessment.trim().length > 0 && assessment.length <= 60 &&
    Number.isInteger(grade) && grade >= 0 && grade <= 100;
}
