document.addEventListener("DOMContentLoaded", () => {
  const Supabase = window.LohasSupabase;
  const supabaseClient = Supabase?.getClient?.() || null;

  const SUPABASE_BUCKET = Supabase?.CONFIG?.STORAGE_BUCKET || "gallery-uploads";
  const SUPABASE_TABLE = Supabase?.CONFIG?.POSTS_TABLE || "gallery_posts";

  const state = {
    selectedSlot: null,
    draggedSlot: null,
    images: [null, null, null],
    files: [null, null, null],
    isPreviewMode: false
  };

  const openUploadBtns = document.querySelectorAll(".js-open-upload");
  const uploadModal = document.getElementById("uploadModal");
  const detailModal = document.getElementById("detailModal");
  const detailBody = document.getElementById("detailBody");
  const closeUpload = document.getElementById("closeUpload");
  const fileInput = document.getElementById("fileInput");
  const uploadBoxes = document.querySelectorAll(".upload-box");
  const shareText = document.getElementById("shareText");
  const currentChar = document.getElementById("currentChar");
  const workTitle = document.getElementById("workTitle");
  const workTitleError = document.getElementById("workTitleError");
  const workCategory = document.getElementById("workCategory");
  const carrierCategory = document.getElementById("carrierCategory");
  const previewBtn = document.getElementById("previewBtn");
  const submitBtn = document.getElementById("submitBtn");

  let cropper = null;
  let cropTargetSlot = null;

  function showToast(message) {
    if (window.LohasGallery?.showToast) {
      window.LohasGallery.showToast(message);
      return;
    }

    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("is-show");

    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.classList.remove("is-show");
    }, 1800);
  }

  function maskName(name) {
    const cleanName = (name || "顧客").trim();

    if (cleanName.length <= 1) return `${cleanName}＊`;

    const first = cleanName.slice(0, 1);
    const suffix = cleanName.includes("先生")
      ? "生"
      : cleanName.includes("小姐")
        ? "姐"
        : cleanName.slice(-1);

    return `${first}＊${suffix}`;
  }

  function openModal() {
    if (!uploadModal) return;

    uploadModal.classList.add("is-open");
    uploadModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!uploadModal) return;

    uploadModal.classList.remove("is-open");
    uploadModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function backToUploadModal() {
    state.isPreviewMode = false;

    uploadModal?.classList.add("is-open");
    uploadModal?.setAttribute("aria-hidden", "false");

    document.body.style.overflow = "hidden";
  }

  function closeCropModal() {
    const cropModal = document.getElementById("cropModal");

    if (cropModal) {
      cropModal.classList.remove("is-open");
      cropModal.setAttribute("aria-hidden", "true");
    }

    if (cropper) cropper.destroy();

    cropper = null;
    cropTargetSlot = null;
  }

  function resetBox(slot) {
    const box = document.querySelector(`.upload-box[data-slot="${slot}"]`);
    if (!box) return;

    const isMain = box.classList.contains("main-upload");

    box.classList.remove("has-image");
    box.setAttribute("draggable", "false");

    box.innerHTML = `
      ${isMain ? '<span class="badge-main">首圖</span>' : ''}
      <div class="upload-placeholder">
        <i class="fa-regular fa-image"></i>
        <p>新增圖片</p>
        <span class="upload-hint">${isMain ? "點擊選擇，或拖曳圖片到這裡" : "副圖"}</span>
      </div>
    `;
  }

  function renderBox(slot) {
    const box = document.querySelector(`.upload-box[data-slot="${slot}"]`);
    if (!box) return;

    const image = state.images[slot];

    if (!image) {
      resetBox(slot);
      return;
    }

    const isMain = box.classList.contains("main-upload");

    box.classList.add("has-image");
    box.setAttribute("draggable", "true");

    box.innerHTML = `
      ${isMain ? '<span class="badge-main">首圖</span>' : ''}
      <img class="preview-image" src="${image}" alt="上傳預覽圖片" />
      <button class="delete-btn" type="button" data-delete-slot="${slot}" aria-label="刪除圖片">
        <i class="fas fa-times"></i>
      </button>
    `;
  }

  function openFilePicker(slot) {
    if (!fileInput) return;

    state.selectedSlot = Number(slot);
    fileInput.value = "";
    fileInput.click();
  }

  function readImageFile(file, slot) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("請上傳圖片格式");
      return;
    }

    cropTargetSlot = slot;

    const reader = new FileReader();

    reader.onload = event => {
      const cropModal = document.getElementById("cropModal");
      const cropImage = document.getElementById("cropImage");

      if (!cropModal || !cropImage) return;

      cropImage.src = event.target.result;
      cropModal.classList.add("is-open");
      cropModal.setAttribute("aria-hidden", "false");

      if (cropper) cropper.destroy();

      cropper = new Cropper(cropImage, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: "move",
        autoCropArea: 1,
        responsive: true,
        background: false,
        movable: true,
        zoomable: true,
        scalable: false,
        rotatable: false
      });
    };

    reader.readAsDataURL(file);
  }

  function base64ToFile(base64, filename) {
    const arr = base64.split(",");
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);

    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }

    return new File([u8arr], filename, { type: mime });
  }

  function swapImages(fromSlot, toSlot) {
    const tempImage = state.images[fromSlot];
    state.images[fromSlot] = state.images[toSlot];
    state.images[toSlot] = tempImage;

    const tempFile = state.files[fromSlot];
    state.files[fromSlot] = state.files[toSlot];
    state.files[toSlot] = tempFile;

    renderBox(fromSlot);
    renderBox(toSlot);
  }

  function getMainImage() {
    return state.images[0];
  }

  function getTitle() {
    return workTitle?.value.trim() || "未命名作品";
  }

  function validateForm() {
    if (workTitleError) {
      workTitleError.textContent = "";
      workTitleError.classList.remove("show");
    }

    if (!getMainImage()) {
      showToast("請至少上傳一張首圖");
      return false;
    }

    if (!workTitle?.value.trim()) {
      if (workTitleError) {
        workTitleError.textContent = "請輸入刻圖照片名稱";
        workTitleError.classList.add("show");
      }

      workTitle?.focus();
      return false;
    }

    return true;
  }

  async function uploadImagesToSupabase() {
    if (!supabaseClient) {
      throw new Error("Supabase 尚未設定");
    }

    const uploadedUrls = [];
    const files = state.files.filter(Boolean);

    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filePath = `public/${Date.now()}-${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabaseClient.storage
        .from(SUPABASE_BUCKET)
        .upload(filePath, file, { cacheControl: "3600", upsert: false });

      if (uploadError) throw uploadError;

      const { data } = supabaseClient.storage
        .from(SUPABASE_BUCKET)
        .getPublicUrl(filePath);

      uploadedUrls.push(data.publicUrl);
    }

    return uploadedUrls;
  }

  async function submitPostToSupabase() {
    if (!supabaseClient) {
      throw new Error("Supabase 尚未設定");
    }

    const member = JSON.parse(localStorage.getItem("lohasMember") || "null");

    if (!member || !member.erpid) {
      throw new Error("請先登入會員後再分享照片");
    }

    const imageUrls = await uploadImagesToSupabase();

    const postPayload = {
      title: getTitle(),
      topic: workCategory.value,
      carrier: carrierCategory.value,
      story: shareText.value.trim(),
      customer_name: member.name || "顧客",
      member_id: member.erpid,
      image_urls: imageUrls,
      main_image_url: imageUrls[0],
      is_public: true
    };

    const { data, error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .insert(postPayload)
      .select("id,title,topic,carrier,story,customer_name,member_id,image_urls,main_image_url,created_at,is_public")
      .single();

    if (error) throw error;

    return data;
  }

  function clearForm() {
    state.images = [null, null, null];
    state.files = [null, null, null];

    uploadBoxes.forEach(box => resetBox(Number(box.dataset.slot)));

    if (workTitle) workTitle.value = "";
    if (shareText) shareText.value = "";
    if (currentChar) currentChar.textContent = "0";
    if (workCategory) workCategory.selectedIndex = 0;
    if (carrierCategory) carrierCategory.selectedIndex = 0;
  }

  function bindUploadEvents() {
    openUploadBtns.forEach(btn => {
      btn.addEventListener("click", event => {
        event.preventDefault();

        const member = JSON.parse(localStorage.getItem("lohasMember") || "null");

        if (!member || !member.erpid) {
          localStorage.setItem("redirectAfterLogin", "gallery.html#upload-area");
          window.location.href = "login.html";
          return;
        }

        openModal();
      });
    });

    closeUpload?.addEventListener("click", closeModal);

    uploadModal?.addEventListener("click", event => {
      if (event.target === uploadModal) closeModal();
    });

    fileInput?.addEventListener("change", event => {
      const file = event.target.files[0];

      if (state.selectedSlot !== null) {
        readImageFile(file, state.selectedSlot);
      }
    });

    uploadBoxes.forEach(box => {
      const slot = Number(box.dataset.slot);
      resetBox(slot);

      box.addEventListener("click", event => {
        const deleteBtn = event.target.closest("[data-delete-slot]");

        if (deleteBtn) {
          event.stopPropagation();

          const deleteSlot = Number(deleteBtn.dataset.deleteSlot);
          state.files[deleteSlot] = null;
          state.images[deleteSlot] = null;

          renderBox(deleteSlot);
          return;
        }

        openFilePicker(slot);
      });

      box.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openFilePicker(slot);
        }
      });

      box.addEventListener("dragover", event => {
        event.preventDefault();
        box.classList.add("drag-enter");
      });

      box.addEventListener("dragleave", () => {
        box.classList.remove("drag-enter");
      });

      box.addEventListener("drop", event => {
        event.preventDefault();

        document.querySelectorAll(".upload-box").forEach(item => {
          item.classList.remove("dragging", "drag-enter");
          item.style.opacity = "";
        });

        const file = event.dataTransfer.files[0];

        if (file) {
          readImageFile(file, slot);
          return;
        }

        if (state.draggedSlot !== null && state.draggedSlot !== slot) {
          swapImages(state.draggedSlot, slot);
        }
      });

      box.addEventListener("dragstart", event => {
        if (!state.images[slot]) {
          event.preventDefault();
          return;
        }

        state.draggedSlot = slot;
        box.classList.add("dragging");
        event.dataTransfer.setData("text/plain", String(slot));
      });

      box.addEventListener("dragend", () => {
        state.draggedSlot = null;

        document.querySelectorAll(".upload-box").forEach(item => {
          item.classList.remove("dragging", "drag-enter");
          item.style.opacity = "";
        });
      });
    });

    shareText?.addEventListener("input", () => {
      currentChar.textContent = shareText.value.length;
    });

    workTitle?.addEventListener("input", () => {
      if (workTitleError) {
        workTitleError.textContent = "";
        workTitleError.classList.remove("show");
      }
    });

    previewBtn?.addEventListener("click", () => {
      if (!validateForm()) return;

      const member = JSON.parse(localStorage.getItem("lohasMember") || "null");
      const previewName = maskName(member?.name || "顧客");
      const images = state.images.filter(Boolean);
      const mainImage = images[0];
      const subImages = images.slice(1, 3);

      detailBody.innerHTML = `
        <div class="detail-gallery">
          <div class="detail-main-image">
            <img src="${mainImage}" alt="${getTitle()}" />
          </div>

          <div class="detail-sub-list">
            ${subImages.map(src => `
              <div class="detail-sub-image">
                <img src="${src}" alt="${getTitle()}" />
              </div>
            `).join("")}
          </div>
        </div>

        <div class="detail-title-row">
          <h3 class="detail-title">${getTitle()}</h3>
          <span class="detail-user">${previewName}</span>
        </div>

        <div class="detail-meta">
          <span class="detail-chip">${workCategory.value}</span>
          <span class="detail-chip">${carrierCategory.value}</span>
        </div>

        <p class="detail-story">
          ${shareText.value.trim() || "這是一份來自顧客的真實刻圖照片分享。"}
        </p>
      `;

      state.isPreviewMode = true;

      detailModal.classList.add("is-open");
      detailModal.setAttribute("aria-hidden", "false");
      uploadModal.classList.remove("is-open");
      uploadModal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "hidden";
    });

    submitBtn?.addEventListener("click", async () => {
      if (!validateForm()) return;

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = "上傳中...";

        const newPost = await submitPostToSupabase();

        window.LohasGallery?.renderGalleryCard?.(newPost, true);
        window.LohasGallery?.applyFilters?.();
        window.LohasGallery?.loadMyFavoriteStates?.();

        closeModal();
        clearForm();

        showToast("你的照片已成功分享");
      } catch (error) {
        console.error(error);
        showToast(error.message || "上傳失敗，請檢查 Supabase 權限設定");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "送出分享";
      }
    });

    document.getElementById("applyCrop")?.addEventListener("click", () => {
      if (!cropper || cropTargetSlot === null) return;

      const canvas = cropper.getCroppedCanvas({
        width: 1200,
        height: 1200,
        imageSmoothingQuality: "high"
      });

      const croppedBase64 = canvas.toDataURL("image/jpeg", 0.9);

      state.images[cropTargetSlot] = croppedBase64;
      state.files[cropTargetSlot] = base64ToFile(
        croppedBase64,
        `gallery_${Date.now()}_${cropTargetSlot}.jpg`
      );

      renderBox(cropTargetSlot);
      closeCropModal();
    });

    document.getElementById("cancelCrop")?.addEventListener("click", closeCropModal);
    document.getElementById("closeCrop")?.addEventListener("click", closeCropModal);
  }

  bindUploadEvents();

  window.LohasUpload = {
    openModal,
    closeModal,
    clearForm,
    isPreviewMode() {
      return state.isPreviewMode;
    },
    backToUploadModal
  };
});
