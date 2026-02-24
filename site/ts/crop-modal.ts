import Cropper from 'cropperjs';
import { Modal } from 'bootstrap';

/**
 * Load a File into an Image element.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

/**
 * Pad an image into a square with a white background, returned as a data URL.
 * The square's side length is max(width, height), image centered.
 */
function padToSquare(img: HTMLImageElement): string {
    const size = Math.max(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const x = (size - img.naturalWidth) / 2;
    const y = (size - img.naturalHeight) / 2;
    ctx.drawImage(img, x, y);
    return canvas.toDataURL('image/png');
}

/**
 * Show a modal that lets the user crop the given image file to a 1:1 square.
 * The image is first padded into a square with a white background so wide/tall
 * images are fully visible. Returns the cropped Blob, or null if the user cancels.
 */
export async function showCropModal(file: File): Promise<Blob | null> {
    const img = await loadImage(file);
    const squareDataUrl = padToSquare(img);
    URL.revokeObjectURL(img.src);

    return new Promise((resolve) => {
        document.getElementById('crop-modal')?.remove();

        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="crop-modal" tabindex="-1" data-bs-backdrop="static">
                <div class="modal-dialog modal-lg modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Crop Logo</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div style="max-height:70vh;overflow:hidden">
                                <img id="crop-image" src="${squareDataUrl}" alt="Crop preview" style="max-width:100%;display:block">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="crop-confirm">
                                <i class="fa-solid fa-crop-simple me-1"></i>Crop
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `);

        const modalEl = document.getElementById('crop-modal')!;
        const imgEl = document.getElementById('crop-image') as HTMLImageElement;
        const bsModal = new Modal(modalEl);
        let cropper: Cropper | null = null;
        let settled = false;

        modalEl.addEventListener('shown.bs.modal', () => {
            cropper = new Cropper(imgEl, {
                aspectRatio: 1,
                viewMode: 1,
                dragMode: 'move',
                autoCropArea: 1,
                cropBoxResizable: true,
                cropBoxMovable: true,
                guides: true,
                center: true,
                background: true,
                responsive: true,
            });
        }, { once: true });

        document.getElementById('crop-confirm')!.addEventListener('click', () => {
            if (!cropper) return;

            const canvas = cropper.getCroppedCanvas({
                width: 512,
                height: 512,
                fillColor: '#fff',
                imageSmoothingQuality: 'high',
            });

            canvas.toBlob((blob) => {
                settled = true;
                bsModal.hide();
                resolve(blob);
            }, 'image/webp', 0.9);
        });

        modalEl.addEventListener('hidden.bs.modal', () => {
            cropper?.destroy();
            modalEl.remove();
            if (!settled) {
                resolve(null);
            }
        }, { once: true });

        bsModal.show();
    });
}
