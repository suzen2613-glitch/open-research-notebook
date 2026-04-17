import os


if os.getenv("OPEN_NOTEBOOK_MINERU_DISABLE_MULTIPROCESS") == "1":
    try:
        import mineru.utils.pdf_image_tools as pdf_image_tools
    except Exception:
        pdf_image_tools = None

    if pdf_image_tools is not None:
        pdf_image_tools.is_windows_environment = lambda: True
