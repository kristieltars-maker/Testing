export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');

export async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

export const api = {
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () =>
    request('/auth/logout', { method: 'POST' }),

  getMe: () =>
    request('/me'),

  getUsers: () =>
    request('/users'),

  createUser: (data) =>
    request('/users', { method: 'POST', body: JSON.stringify(data) }),

  updateUser: (id, data) =>
    request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteUser: (id) =>
    request(`/users/${id}`, { method: 'DELETE' }),

  changePassword: (id, password) =>
    request(`/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) }),

  getUserMemberships: (id) =>
    request(`/users/${id}/memberships`),

  setUserMemberships: (id, memberships) =>
    request(`/users/${id}/memberships`, { method: 'PUT', body: JSON.stringify({ memberships }) }),

  getProjects: () =>
    request('/projects'),

  getProject: (id) =>
    request(`/projects/${id}`),

  getProjectUsers: (id) =>
    request(`/projects/${id}/users`),

  createProject: (data) =>
    request('/projects', { method: 'POST', body: JSON.stringify(data) }),

  updateProject: (id, data) =>
    request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteProject: (id) =>
    request(`/projects/${id}`, { method: 'DELETE' }),

  addBot: (projectId, data) =>
    request(`/projects/${projectId}/bots`, { method: 'POST', body: JSON.stringify(data) }),

  updateBot: (projectId, botId, data) =>
    request(`/projects/${projectId}/bots/${botId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteBot: (projectId, botId) =>
    request(`/projects/${projectId}/bots/${botId}`, { method: 'DELETE' }),

  addMember: (projectId, data) =>
    request(`/projects/${projectId}/members`, { method: 'POST', body: JSON.stringify(data) }),

  removeMember: (projectId, userId) =>
    request(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),

  getIssues: (params) => {
    const query = new URLSearchParams(params).toString();
    return request(`/issues?${query}`);
  },

  getIssue: (id) =>
    request(`/issues/${id}`),

  issueView: (id) =>
    request(`/issues/${id}/view`, { method: 'POST' }),

  createIssue: (formData, projectId) =>
    fetch(`${API_URL}/issues`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }),

  addMessage: (issueId, formData) =>
    fetch(`${API_URL}/issues/${issueId}/messages`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }),

  editMessage: (issueId, messageId, formData) =>
    fetch(`${API_URL}/issues/${issueId}/messages/${messageId}`, {
      method: 'PATCH',
      credentials: 'include',
      body: formData
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }),

  deleteMessage: (issueId, messageId) =>
    request(`/issues/${issueId}/messages/${messageId}`, { method: 'DELETE' }),

  assignIssue: (id, assigned_to) =>
    request(`/issues/${id}/assign`, { method: 'PATCH', body: JSON.stringify({ assigned_to }) }),

  updateIssue: (id, data) =>
    request(`/issues/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteIssue: (id) =>
    request(`/issues/${id}`, { method: 'DELETE' })
};
