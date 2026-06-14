export const setToken = (token: string, type: 'user' | 'admin' | 'subadmin' = 'user') => {
  if (type === 'user') {
    localStorage.setItem('supertv_token', token);
  } else {
    localStorage.setItem('supertv_admin_token', token);
  }
};

export const getToken = (type: 'user' | 'admin' | 'subadmin' = 'user') => {
  if (type === 'user') {
    return localStorage.getItem('supertv_token');
  } else {
    return localStorage.getItem('supertv_admin_token');
  }
};

export const clearTokens = () => {
  localStorage.removeItem('supertv_token');
  localStorage.removeItem('supertv_admin_token');
  localStorage.removeItem('supertv_remembered_code');
};
