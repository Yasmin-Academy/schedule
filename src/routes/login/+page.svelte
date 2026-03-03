<script lang="ts">
  let password = '';
  let errorMsg: string | null = null;
  let loading = false;

  async function submit() {
    if (loading) return;
    loading = true;
    errorMsg = null;

    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (res.ok) {
        window.location.href = '/dashboard';
        return;
      }

      const data = await res.json().catch(() => ({}));
      errorMsg = data?.error || data?.message || 'Login failed';
    } catch {
      errorMsg = 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<div style="max-width: 420px; margin: 60px auto; padding: 20px;">
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 16px;">Admin Login</h1>

  <form on:submit|preventDefault={submit}>
    <label for="admin-password" style="display:block; margin-bottom: 8px;">
      Password
    </label>

    <input
      id="admin-password"
      type="password"
      bind:value={password}
      autocomplete="current-password"
      aria-invalid={errorMsg ? 'true' : 'false'}
      style="width:100%; padding:10px; border:1px solid #ccc; border-radius:6px;"
    />

    {#if errorMsg}
      <p style="color: #b91c1c; margin-top: 12px;">{errorMsg}</p>
    {/if}

    <button
      type="submit"
      disabled={loading}
      style="margin-top: 14px; width:100%; padding:10px; border-radius:6px; cursor:pointer;"
    >
      {loading ? 'Signing in…' : 'Sign in'}
    </button>
  </form>
</div>