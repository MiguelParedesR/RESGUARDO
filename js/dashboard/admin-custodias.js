// === BEGIN HU:HU-ADMIN-CUSTODIAS-PANEL (NO TOCAR FUERA) ===
(function () {
  "use strict";

  const state = {
    custodias: [],
    filtros: {
      estado: "TODOS",
      empresa: "TODAS",
      busca: "",
    },
    loading: false,
  };

  const ui = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (!window.sb) {
      alert("Supabase no inicializado");
      return;
    }
    mapUI();
    bindEvents();
    loadCustodias().catch((err) => {
      console.error("[custodias] load error", err);
      showMsg("No se pudieron cargar las custodias.");
    });
  }

  function mapUI() {
    ui.fEstado = document.getElementById("filtro-estado");
    ui.fEmpresa = document.getElementById("filtro-empresa");
    ui.buscar = document.getElementById("buscar-custodias");
    ui.tabla = document.getElementById("tabla-custodias");
    ui.modalDetalle = document.getElementById("modal-detalle");
    ui.detalleNombre = document.getElementById("detalle-nombre");
    ui.detalleDni = document.getElementById("detalle-dni");
    ui.detalleEmpresa = document.getElementById("detalle-empresa");
    ui.detalleEstado = document.getElementById("detalle-estado");
    ui.detalleCreado = document.getElementById("detalle-creado");
    ui.detalleSelfie = document.getElementById("detalle-selfie");
    ui.snackbar = document.getElementById("app-snackbar");
  }

  function bindEvents() {
    ui.fEstado?.addEventListener("change", () => {
      state.filtros.estado = ui.fEstado.value;
      loadCustodias();
    });
    ui.fEmpresa?.addEventListener("change", () => {
      state.filtros.empresa = ui.fEmpresa.value;
      loadCustodias();
    });
    ui.buscar?.addEventListener(
      "input",
      debounce((evt) => {
        state.filtros.busca = evt.target.value.trim();
        loadCustodias();
      }, 300)
    );
    ui.modalDetalle
      ?.querySelectorAll("[data-close]")
      .forEach((btn) => btn.addEventListener("click", () => ui.modalDetalle.close()));
  }

  async function loadCustodias() {
    if (state.loading) return;
    state.loading = true;
    try {
      let query = window.sb
        .from("custodia")
        .select(
          "id,nombre,dni,empresa,empresa_otro,is_active,created_at,selfie_bytes,selfie_mime_type"
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (state.filtros.estado === "ACTIVO") {
        query = query.eq("is_active", true);
      } else if (state.filtros.estado === "INACTIVO") {
        query = query.eq("is_active", false);
      }
      if (state.filtros.empresa === "OTRA") {
        query = query.is("empresa", null);
      } else if (state.filtros.empresa !== "TODAS") {
        query = query.eq("empresa", state.filtros.empresa);
      }
      if (state.filtros.busca) {
        const term = `%${state.filtros.busca.toUpperCase()}%`;
        query = query.or(`nombre.ilike.${term},dni.ilike.${term}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      state.custodias = data || [];
      renderTabla();
    } catch (err) {
      console.error("[custodias] query error", err);
      showMsg("Error cargando custodias.");
    } finally {
      state.loading = false;
    }
  }

  function renderTabla() {
    if (!ui.tabla) return;
    ui.tabla.innerHTML = "";
    if (!state.custodias.length) {
      const row = document.createElement("tr");
      row.innerHTML = `<td colspan="7" class="tabla-empty">No se encontraron custodias.</td>`;
      ui.tabla.appendChild(row);
      return;
    }
    state.custodias.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${buildThumb(row)}</td>
        <td>${row.nombre || "--"}</td>
        <td>${row.dni || "--"}</td>
        <td>${formatEmpresa(row)}</td>
        <td><span class="badge ${
          row.is_active ? "badge--active" : "badge--inactive"
        }">${row.is_active ? "Activo" : "Inactivo"}</span></td>
        <td>${formatDate(row.created_at)}</td>
        <td>
          <div class="tabla-actions">
            <button data-action="detalle"><i class="material-icons" aria-hidden="true">visibility</i> Ver</button>
            <button data-action="toggle"><i class="material-icons" aria-hidden="true">${
              row.is_active ? "block" : "check_circle"
            }</i> ${row.is_active ? "Desactivar" : "Reactivar"}</button>
          </div>
        </td>
      `;
      tr.querySelector('[data-action="detalle"]')?.addEventListener("click", () => abrirDetalle(row));
      tr.querySelector('[data-action="toggle"]')?.addEventListener("click", () => toggleEstado(row));
      ui.tabla.appendChild(tr);
    });
  }

  function buildThumb(row) {
    const src = buildSelfieSrc(row);
    if (src) {
      return `<img class="thumb" src="${src}" alt="Selfie de ${row.nombre || "custodia"}" />`;
    }
    const initial = (row.nombre || "?").trim().charAt(0).toUpperCase() || "?";
    return `<span class="thumb thumb--placeholder">${initial}</span>`;
  }

  function buildSelfieSrc(row) {
    if (!row?.selfie_bytes) return null;
    const mime = row.selfie_mime_type || "image/jpeg";
    return `data:${mime};base64,${toBase64(row.selfie_bytes)}`;
  }

  function abrirDetalle(row) {
    if (!ui.modalDetalle) return;
    ui.detalleNombre.textContent = row.nombre || "Custodia";
    ui.detalleDni.textContent = row.dni || "--";
    ui.detalleEmpresa.textContent = formatEmpresa(row);
    ui.detalleEstado.textContent = row.is_active ? "Activo" : "Inactivo";
    ui.detalleCreado.textContent = formatDate(row.created_at);
    const src = buildSelfieSrc(row);
    if (src) {
      ui.detalleSelfie.src = src;
      ui.detalleSelfie.alt = `Selfie de ${row.nombre || "custodia"}`;
    } else {
      ui.detalleSelfie.src = "/assets/img/login-hero-bg.jpg";
      ui.detalleSelfie.alt = "Selfie no disponible";
    }
    ui.modalDetalle.showModal();
  }

  async function toggleEstado(row) {
    try {
      const nuevoEstado = !row.is_active;
      const { error } = await window.sb
        .from("custodia")
        .update({ is_active: nuevoEstado })
        .eq("id", row.id);
      if (error) throw error;
      showMsg(`Custodia ${nuevoEstado ? "activada" : "desactivada"}.`);
      await loadCustodias();
    } catch (err) {
      console.error("[custodias] toggle", err);
      showMsg("No se pudo actualizar el estado.");
    }
  }

  function formatEmpresa(row) {
    if (row.empresa) return row.empresa;
    if (row.empresa_otro) return row.empresa_otro;
    return "Sin empresa";
  }

  function formatDate(value) {
    if (!value) return "--";
    try {
      return new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function toBase64(data) {
    try {
      if (!data) return "";
      if (/^[A-Za-z0-9+/]+=*$/.test(data)) return data;
      if (typeof data === "string" && data.startsWith("\\x")) {
        const hex = data.slice(2);
        let bin = "";
        for (let i = 0; i < hex.length; i += 2) {
          bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        }
        return btoa(bin);
      }
      return btoa(data);
    } catch {
      return "";
    }
  }

  function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function showMsg(message) {
    if (ui.snackbar?.MaterialSnackbar) {
      ui.snackbar.MaterialSnackbar.showSnackbar({ message });
    } else {
      alert(message);
    }
  }
})();
// === END HU:HU-ADMIN-CUSTODIAS-PANEL ===
